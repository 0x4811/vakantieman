// Presentatiescherm (voor de beamer): toont de sessie live. Bediening via toetsenbord of telefoon.

import "./style.css";
import "./present.css";
import type { SessionScript, SessionState } from "../shared/session";
import { $, h, mount } from "./dom";
import { codeFromPath, connectLive } from "./live";
import { photoUrl } from "./api";
import { Stage } from "./stage";

const app = $("#app");
const code = codeFromPath();
let stage: Stage | null = null;
let current: { script: SessionScript; state: SessionState } | null = null;
let photoId = "";

const status = h("div", { class: "conn conn--off", title: "Verbinding" });
document.body.append(status);

mount(app, h("div", { class: "present-wait" }, [h("h1", null, "Verbinden…"), h("p", { class: "muted" }, `Sessie ${code}`)]));

const live = connectLive(code, "present", {
  onStatus(online) {
    status.classList.toggle("conn--off", !online);
  },
  onMessage(message) {
    switch (message.t) {
      case "snapshot": {
        photoId = message.script.photo.id;
        const options = { photoSrc: (variant: "original" | "masked") => photoUrl(photoId, variant) };
        if (!stage) {
          stage = new Stage(app, message.script, message.state, options);
        } else if (current?.script.photo.id !== photoId || JSON.stringify(current.script) !== JSON.stringify(message.script)) {
          stage.setScript(message.script);
        }
        current = { script: message.script, state: message.state };
        stage.update(message.state, message.results);
        stage.setVotes(message.votes, message.vote_count);
        break;
      }
      case "state":
        if (current) current.state = message.state;
        stage?.update(message.state, message.results);
        break;
      case "votes":
        stage?.setVotes(message.points, message.count);
        break;
      default:
        break;
    }
  }
});

window.addEventListener("resize", () => stage?.resize());

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
      e.preventDefault();
      live.send({ type: "next" });
      break;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
      e.preventDefault();
      live.send({ type: "prev" });
      break;
    case "b":
    case "B":
    case ".":
      live.send({ type: "blank" });
      break;
    case "f":
    case "F":
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
      break;
  }
});
