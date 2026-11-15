// Offline-speler: één los HTML-bestand met het sessiescript en de foto's erin. Geen netwerk nodig.
// Bediening: pijltjestoetsen/spatie, B (zwart), F (beeldvullend), of tik rechts/links op het scherm.

import "./style.css";
import "./present.css";
import { initialState, reduce, scriptCounts, computeResults, topCandidate, type Action, type RevealResults, type SessionScript, type SessionState } from "../shared/session";
import { $, h } from "./dom";
import { OfflineMap } from "./offline-map";
import { Stage } from "./stage";

interface Pack {
  script: SessionScript;
  photos: { original: string; masked: string | null };
}

const app = $("#app");
const raw = document.getElementById("pack")?.textContent?.trim() ?? "";
let pack: Pack | null = null;
try {
  pack = raw.startsWith("{") ? (JSON.parse(raw) as Pack) : null;
} catch {
  pack = null;
}

if (!pack) {
  app.append(h("div", { class: "present-wait" }, [h("h1", null, "Geen sessie ingesloten"), h("p", { class: "muted" }, "Maak dit bestand via Beheer > Sessies > Offline-pakket.")]));
} else {
  const { script, photos } = pack;
  const counts = scriptCounts(script);
  let state: SessionState = initialState();

  const results = (): RevealResults | null =>
    ["reveal", "lesson", "masked", "done"].includes(state.phase)
      ? computeResults([], script.photo.truth, topCandidate(script.analysis), topCandidate(script.masked))
      : null;

  const stage = new Stage(app, script, state, {
    offline: true,
    photoSrc: (variant) => (variant === "masked" && photos.masked ? photos.masked : photos.original),
    createMap: (el) => new OfflineMap(el)
  });
  stage.setVotes([], 0);

  const apply = (action: Action): void => {
    // Offline is er geen raadronde met stemmen: de stemvlag is irrelevant.
    state = reduce(state, action, counts);
    stage.update(state, results());
  };
  stage.update(state, results());

  const bar = h("div", { class: "offline-bar" }, [
    h("button", { class: "btn", onclick: () => apply({ type: "prev" }), "aria-label": "Vorige" }, "◀"),
    h("button", { class: "btn", onclick: () => apply({ type: "blank" }), "aria-label": "Zwart scherm" }, "■"),
    h("button", { class: "btn btn--primary", onclick: () => apply({ type: "next" }), "aria-label": "Volgende" }, "▶")
  ]);
  document.body.append(bar);
  let hideTimer = 0;
  const show = (): void => {
    bar.classList.add("is-visible");
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => bar.classList.remove("is-visible"), 3000);
  };
  window.addEventListener("pointermove", show);
  window.addEventListener("pointerdown", show);

  window.addEventListener("resize", () => stage.resize());
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) (e.preventDefault(), apply({ type: "next" }));
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) (e.preventDefault(), apply({ type: "prev" }));
    else if (e.key === "b" || e.key === "B" || e.key === ".") apply({ type: "blank" });
    else if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    }
  });
}
