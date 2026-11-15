// Beheer van sessies: aanmaken, links openen, QR-code voor de bediening, vernieuwen en verwijderen.

import { api } from "./api";
import { formatDateTime, h, mount, openModal, toast } from "./dom";
import { qrDataUrl } from "./qr";
import { formatKm } from "../shared/geo";
import type { AnalysisDto, PhotoDto, SessionDto } from "../shared/types";

const STATE_LABEL: Record<SessionDto["state"], string> = { created: "Klaar", live: "Live", ended: "Afgesloten" };

export async function renderSessions(container: HTMLElement, photos: PhotoDto[]): Promise<void> {
  mount(container, h("div", { class: "empty" }, h("span", { class: "spinner" }), " Laden…"));
  let sessions: SessionDto[];
  try {
    sessions = await api<SessionDto[]>("/api/sessions");
  } catch (error) {
    mount(container, h("div", { class: "empty" }, (error as Error).message));
    return;
  }
  const reload = (): Promise<void> => renderSessions(container, photos);

  const photoSelect = h("select", null, [h("option", { value: "" }, "Kies een foto…"), ...photos.map((p) => h("option", { value: p.id }, `${p.label} (${p.true_place})`))]);
  const analysisSelect = h("select", { disabled: true }, h("option", { value: "" }, "Kies eerst een foto"));
  const maskedSelect = h("select", { disabled: true }, h("option", { value: "" }, "Geen"));
  const createBtn = h("button", { class: "btn btn--primary", disabled: true }, "Sessie maken");
  const hint = h("p", { class: "muted small" }, "Alleen goedgekeurde analyses kunnen worden gebruikt.");

  photoSelect.addEventListener("change", async () => {
    analysisSelect.replaceChildren(h("option", { value: "" }, "Laden…"));
    maskedSelect.replaceChildren(h("option", { value: "" }, "Geen"));
    createBtn.disabled = true;
    if (!photoSelect.value) return;
    try {
      const list = await api<AnalysisDto[]>(`/api/photos/${photoSelect.value}/analyses`);
      const original = list.filter((a) => a.variant === "original" && a.approved);
      const masked = list.filter((a) => a.variant === "masked" && a.approved);
      analysisSelect.replaceChildren(
        ...(original.length
          ? original.map((a) => h("option", { value: a.id }, `${a.provider} · ${a.model} · ${formatDateTime(a.created_at)}`))
          : [h("option", { value: "" }, "Geen goedgekeurde analyse")])
      );
      maskedSelect.replaceChildren(h("option", { value: "" }, "Geen"), ...masked.map((a) => h("option", { value: a.id }, `${a.provider} · ${a.model} · ${formatDateTime(a.created_at)}`)));
      analysisSelect.disabled = original.length === 0;
      maskedSelect.disabled = masked.length === 0;
      createBtn.disabled = original.length === 0;
    } catch (error) {
      toast((error as Error).message, "error");
    }
  });

  createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    try {
      await api<SessionDto>("/api/sessions", {
        method: "POST",
        json: { photo_id: photoSelect.value, analysis_id: analysisSelect.value, masked_analysis_id: maskedSelect.value || null }
      });
      toast("Sessie gemaakt.", "ok");
      await reload();
    } catch (error) {
      toast((error as Error).message, "error");
      createBtn.disabled = false;
    }
  });

  const rows = sessions.map((s) => sessionCard(s, photos, reload));

  mount(
    container,
    h("h1", { style: { fontSize: "22px" } }, "Sessies"),
    h("div", { class: "item" }, [
      h("h3", null, "Nieuwe sessie"),
      h("label", { class: "stack", style: { gap: "4px" } }, [h("span", { class: "small muted" }, "Foto"), photoSelect]),
      h("label", { class: "stack", style: { gap: "4px" } }, [h("span", { class: "small muted" }, "Analyse van de originele foto"), analysisSelect]),
      h("label", { class: "stack", style: { gap: "4px" } }, [h("span", { class: "small muted" }, "Analyse van de bewerkte foto (optioneel)"), maskedSelect]),
      h("div", { class: "row" }, createBtn),
      hint
    ]),
    rows.length ? h("div", { class: "list" }, rows) : h("div", { class: "empty" }, "Nog geen sessies.")
  );
}

function sessionCard(s: SessionDto, photos: PhotoDto[], reload: () => Promise<void>): HTMLElement {
  const photo = photos.find((p) => p.id === s.photo_id);
  const origin = location.origin;
  const present = `${origin}/present/${s.code}`;
  const control = `${origin}/control/${s.code}`;
  return h("div", { class: "item" }, [
    h("div", { class: "row row--between" }, [
      h("div", null, [h("b", { class: "mono", style: { fontSize: "20px", letterSpacing: ".15em" } }, s.code), " ", h("span", { class: "muted small" }, photo?.label ?? "(foto verwijderd)")]),
      h("span", { class: s.state === "live" ? "chip chip--ok" : "chip" }, STATE_LABEL[s.state])
    ]),
    s.summary
      ? h("p", { class: "small muted" }, `${s.summary.votes} gokken · mediaan ${formatKm(s.summary.median_km)} · tool ${formatKm(s.summary.tool_km)}`)
      : h("p", { class: "small muted" }, `Gemaakt ${formatDateTime(s.created_at)}`),
    h("div", { class: "row" }, [
      s.state !== "ended" ? h("a", { class: "btn", href: present, target: "_blank", rel: "noopener" }, "Presentatie") : null,
      s.state !== "ended" ? h("a", { class: "btn", href: control, target: "_blank", rel: "noopener" }, "Bediening") : null,
      s.state !== "ended" ? h("button", { class: "btn", onclick: () => void showQr(control, s.code) }, "QR bediening") : null,
      s.state !== "ended"
        ? h("button", { class: "btn", onclick: () => void refresh(s, reload) }, "Vernieuwen")
        : null,
      h("button", { class: "btn btn--danger", onclick: () => void remove(s, reload) }, "Verwijderen")
    ])
  ]);
}

async function refresh(s: SessionDto, reload: () => Promise<void>): Promise<void> {
  try {
    const force = s.state === "live" ? (confirm("Deze sessie is live. Vernieuwen kan de presentatie verstoren. Toch doorgaan?") ? "?force=1" : null) : "";
    if (force === null) return;
    await api(`/api/sessions/${s.id}/refresh${force}`, { method: "POST" });
    toast("Script vernieuwd.", "ok");
    await reload();
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

async function remove(s: SessionDto, reload: () => Promise<void>): Promise<void> {
  if (!confirm(`Sessie ${s.code} verwijderen? Dit wist ook de gokken.`)) return;
  try {
    await api(`/api/sessions/${s.id}`, { method: "DELETE" });
    await reload();
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

async function showQr(url: string, code: string): Promise<void> {
  const img = h("img", { alt: `QR-code bediening ${code}`, width: 320, height: 320, style: { background: "#fff", borderRadius: "12px" } });
  img.src = await qrDataUrl(url, 640);
  const close = openModal(
    h("div", { class: "stack", style: { alignItems: "center" } }, [
      h("h2", null, `Bediening ${code}`),
      img,
      h("p", { class: "muted small mono" }, url),
      h("p", { class: "muted small" }, "Scan met je telefoon. Je moet ingelogd zijn via Cloudflare Access."),
      h("button", { class: "btn", onclick: () => close() }, "Sluiten")
    ])
  );
}
