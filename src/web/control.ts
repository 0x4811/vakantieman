// Bediening voor op de telefoon: volgende/vorige, fasesprong, stemmen, zwart scherm en afsluiten.

import "./style.css";
import "./control.css";
import { PHASES, PHASE_LABELS, lessonClues, type Phase, type RevealResults, type SessionScript, type SessionState } from "../shared/session";
import { formatKm } from "../shared/geo";
import { $, h, mount } from "./dom";
import { codeFromPath, connectLive } from "./live";

const app = $("#app");
const code = codeFromPath();
let script: SessionScript | null = null;
let state: SessionState | null = null;
let results: RevealResults | null = null;
let voteCount = 0;
let clients = { present: 0, control: 0 };
let online = false;

const live = connectLive(code, "control", {
  onStatus(value) {
    online = value;
    render();
  },
  onMessage(message) {
    switch (message.t) {
      case "snapshot":
        script = message.script;
        state = message.state;
        results = message.results;
        voteCount = message.vote_count;
        clients = message.clients;
        break;
      case "state":
        state = message.state;
        results = message.results;
        break;
      case "votes":
        voteCount = message.count;
        break;
      case "clients":
        clients = message.clients;
        break;
      default:
        return;
    }
    render();
  }
});

// Scherm aan houden tijdens de presentatie.
async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
    await nav.wakeLock?.request("screen");
  } catch {
    /* niet ondersteund of geweigerd */
  }
}
void keepAwake();
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void keepAwake());

function notes(s: SessionScript, st: SessionState): string {
  switch (st.phase) {
    case "idle":
      return "Welkom. Leg uit: één selfie, wat ziet het publiek, wat ziet de tool? Druk op Volgende om de raadronde te openen.";
    case "guessing":
      return `Vraag het publiek te scannen en te raden. Code: ${s.code}. Wacht tot er genoeg gokken zijn.`;
    case "analysis": {
      const clue = st.step > 0 ? s.analysis.clues[st.step - 1] : null;
      return clue ? `Nu zichtbaar: ${clue.description}` : "De tool gaat kijken. Elke druk op Volgende onthult een aanwijzing.";
    }
    case "reveal":
      return `Echte plek: ${s.photo.truth.place}. Publiek mediaan ${formatKm(results?.median_km)}, tool ${formatKm(results?.tool_km)}.`;
    case "lesson": {
      const item = st.step > 0 ? lessonClues(s)[st.step - 1] : null;
      return item ? `Tip: ${item.leak_advice}` : "Overzicht van wat de tool verraadde. Daarna per aanwijzing de tip.";
    }
    case "masked":
      return st.step === 0 ? "Dezelfde foto, met de verraders onzichtbaar gemaakt." : "De tool is nu onzeker. Vergelijk voor en na.";
    case "done":
      return "Afsluiting. De stemmen zijn gewist.";
  }
}

function render(): void {
  if (!script || !state) {
    mount(app, h("div", { class: "c-wait" }, [h("h1", null, online ? "Sessie laden…" : "Verbinden…"), h("p", { class: "muted" }, `Sessie ${code}`)]));
    return;
  }
  const st = state;
  const ended = st.ended;
  const send = live.send;
  const phases = PHASES.filter((p) => p !== "masked" || script?.masked);

  mount(
    app,
    h("header", { class: "c-head" }, [
      h("div", null, [h("div", { class: "c-phase" }, PHASE_LABELS[st.phase]), h("div", { class: "muted small" }, `Stap ${st.step} · ${script.photo.label}`)]),
      h("div", { class: "c-conn" }, [
        h("span", { class: online ? "dot dot--on" : "dot" }),
        online ? `${clients.present} scherm${clients.present === 1 ? "" : "en"}` : "Offline"
      ])
    ]),
    h("p", { class: "c-notes" }, notes(script, st)),
    h("div", { class: "c-stats" }, [
      h("div", null, [h("b", null, voteCount), h("span", null, " gokken")]),
      h("div", null, [h("span", null, "Stemmen "), h("b", null, st.votesOpen ? "open" : "dicht")])
    ]),
    h("div", { class: "c-nav" }, [
      h("button", { class: "btn c-prev", disabled: ended || !online, onclick: () => send({ type: "prev" }) }, "Vorige"),
      h("button", { class: "btn btn--primary c-next", disabled: ended || !online || st.phase === "done", onclick: () => send({ type: "next" }) }, "Volgende")
    ]),
    h(
      "div",
      { class: "c-jump" },
      phases.map((p: Phase) =>
        h("button", { class: `chip${st.phase === p ? " is-active" : ""}`, disabled: ended || !online, onclick: () => send({ type: "goto", phase: p }) }, PHASE_LABELS[p])
      )
    ),
    h("div", { class: "c-row" }, [
      h(
        "button",
        { class: "btn", disabled: ended || !online || st.phase !== "guessing", onclick: () => send({ type: "votes", open: !st.votesOpen }) },
        st.votesOpen ? "Sluit raadronde" : "Open raadronde"
      ),
      h("button", { class: `btn${st.blank ? " btn--primary" : ""}`, disabled: !online, onclick: () => send({ type: "blank" }) }, st.blank ? "Scherm tonen" : "Zwart scherm")
    ]),
    h("div", { class: "c-row c-danger" }, [
      h(
        "button",
        {
          class: "btn btn--danger",
          disabled: ended || !online,
          onclick: () => {
            if (confirm("Sessie afsluiten? De stemmen worden gewist.")) send({ type: "end" });
          }
        },
        ended ? "Sessie is afgesloten" : "Sluit sessie af"
      ),
      h(
        "button",
        {
          class: "btn btn--ghost",
          disabled: ended || !online,
          onclick: () => {
            if (confirm("Terug naar het begin? Alle gokken worden gewist.")) send({ type: "reset" });
          }
        },
        "Opnieuw beginnen"
      )
    ])
  );
}
render();
