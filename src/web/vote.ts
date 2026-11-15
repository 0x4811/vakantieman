// Stempagina voor het publiek: tik op de kaart, verstuur je gok. Geen inlog, geen persoonsgegevens:
// alleen een willekeurige code (in je browser) zodat je je gok kunt aanpassen.

import "./style.css";
import "./vote.css";
import { $, h, mount } from "./dom";
import { DemoMap } from "./map";

const app = $("#app");
const code = (location.pathname.split("/").filter(Boolean)[1] ?? "").toUpperCase();

function token(): string {
  const key = `vakantieman-token-${code}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
  } catch {
    /* opslag niet beschikbaar */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const fresh = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    localStorage.setItem(key, fresh);
  } catch {
    /* geen opslag: de gok werkt nog steeds, alleen aanpassen na herladen niet */
  }
  return fresh;
}
const myToken = token();

type Status = { open: boolean; ended: boolean; started: boolean; count: number } | { error: string } | null;
let status: Status = null;
let pick: { lat: number; lon: number } | null = null;
let sent: { lat: number; lon: number } | null = null;
let message = "";
let busy = false;
let map: DemoMap | null = null;

const mapBox = h("div", { class: "vote-map" });
const bar = h("div", { class: "vote-bar" });

function renderBar(): void {
  const s = status;
  if (!s || "error" in s) {
    mount(bar, h("p", { class: "vote-msg" }, s ? "Deze sessie bestaat niet (meer). Controleer de code." : "Verbinden…"));
    return;
  }
  if (s.ended) return void mount(bar, h("p", { class: "vote-msg" }, "Bedankt voor het meedoen. De sessie is afgelopen."));
  if (!s.open) {
    return void mount(
      bar,
      h("p", { class: "vote-msg" }, s.started ? "De raadronde is gesloten. Kijk naar het scherm." : "Wacht even: de raadronde is nog niet geopend.")
    );
  }
  const changed = pick !== null && (sent === null || sent.lat !== pick.lat || sent.lon !== pick.lon);
  mount(
    bar,
    h("p", { class: "vote-msg" }, message || (pick ? "Is dit je gok? Verstuur hem." : "Tik op de kaart waar je denkt dat Wouter is.")),
    h(
      "button",
      {
        class: "btn btn--primary vote-send",
        disabled: !pick || !changed || busy,
        onclick: () => void submit()
      },
      sent ? (changed ? "Gok aanpassen" : "Gok verstuurd") : "Gok versturen"
    )
  );
}

async function submit(): Promise<void> {
  if (!pick || busy) return;
  busy = true;
  renderBar();
  try {
    const res = await fetch(`/api/vote/${code}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: myToken, lat: pick.lat, lon: pick.lon })
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      sent = pick;
      message = "Gok ontvangen. Je kunt hem nog aanpassen zolang de ronde open is.";
    } else message = body.error ?? "Versturen mislukt.";
  } catch {
    message = "Geen verbinding. Probeer het opnieuw.";
  }
  busy = false;
  renderBar();
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(`/api/vote/${code}/status`, { cache: "no-store" });
    status = (await res.json()) as Status;
  } catch {
    /* netwerkstoring: oude status blijft staan */
  }
  renderBar();
  window.setTimeout(poll, status && "open" in status && status.open ? 3000 : 2000);
}

mount(
  app,
  h("header", { class: "vote-head" }, [h("h1", null, "Waar is Wouter?"), h("span", { class: "mono vote-code" }, code)]),
  mapBox,
  bar
);

map = new DemoMap(mapBox, {
  center: [10, 30],
  zoom: 1.3,
  interactive: true,
  onClick: (lat, lon) => {
    if (status && "open" in status && !status.open) return;
    pick = { lat, lon };
    message = "";
    map?.setPins([{ id: "pick", lat, lon, kind: "pick" }]);
    renderBar();
  }
});

renderBar();
void poll();
