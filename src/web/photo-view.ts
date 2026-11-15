// Foto met genummerde kaders voor de aanwijzingen.

import { h } from "./dom";
import type { Clue } from "../shared/types";

export interface PhotoStage {
  el: HTMLElement;
  /** Welke kaders zichtbaar zijn en welke is uitgelicht. */
  show(visible: Set<string> | "all" | "none", focus?: string | null): void;
  setSource(src: string): void;
}

export function photoStage(
  src: string,
  clues: Clue[],
  options: { onSelect?: (id: string) => void; label?: (clue: Clue, index: number) => string } = {}
): PhotoStage {
  const img = h("img", { src, alt: "Foto", draggable: false });
  const stage = h("div", { class: "photo-stage" }, img);
  const boxes = new Map<string, HTMLElement>();

  clues.forEach((clue, index) => {
    if (!clue.box) return;
    const [x1, y1, x2, y2] = clue.box;
    const tag = h("span", { class: "tag" }, options.label ? options.label(clue, index) : String(index + 1));
    const box = h(
      "div",
      {
        class: "box",
        style: { left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` },
        onclick: () => options.onSelect?.(clue.id)
      },
      tag
    );
    boxes.set(clue.id, box);
    stage.append(box);
  });

  const show: PhotoStage["show"] = (visible, focus = null) => {
    for (const [id, box] of boxes) {
      const on = visible === "all" || (visible !== "none" && visible.has(id));
      box.classList.toggle("is-visible", on);
      box.classList.toggle("is-focus", on && focus === id);
    }
  };

  return { el: stage, show, setSource: (next) => (img.src = next) };
}
