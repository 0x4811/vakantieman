// Onzichtbaar maken: dek de aanwijzingen af die de tool verraden, in de browser. Het resultaat
// krijgt exact de afmetingen van het origineel en wordt als "bewerkte foto" opgeslagen.

import { api, photoUrl } from "./api";
import { h, openModal, toast } from "./dom";
import { canvasToJpeg, finalizeJpeg } from "./image-tools";
import { expandBox, normalizeBox, pixelBlock } from "../shared/mask";
import { CLUE_CATEGORY_LABELS, type AnalysisDto, type Box, type PhotoDto } from "../shared/types";

interface Region {
  id: string;
  label: string;
  box: Box;
  on: boolean;
  manual: boolean;
}

type Effect = "pixel" | "fill";

export function openMaskEditor(photo: PhotoDto, analysis: AnalysisDto | null, onSaved: () => void): void {
  const regions: Region[] = (analysis?.result.clues ?? [])
    .filter((c) => c.box && !c.hidden)
    .map((c, i) => ({ id: c.id, label: `${i + 1}. ${CLUE_CATEGORY_LABELS[c.category]}: ${c.description}`, box: c.box as Box, on: true, manual: false }));
  let effect: Effect = "pixel";
  let pad = 0.15;
  let drawing: { start: [number, number]; current: [number, number] } | null = null;
  let counter = 0;

  const canvas = h("canvas", { class: "mask-canvas", width: photo.width, height: photo.height });
  const overlay = h("div", { class: "mask-overlay" });
  const stage = h("div", { class: "mask-stage" }, canvas, overlay);
  const list = h("div", { class: "list" });
  const saveBtn = h("button", { class: "btn btn--primary" }, "Opslaan als bewerkte foto");
  const img = new Image();
  img.crossOrigin = "anonymous";

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    toast("Canvas is niet beschikbaar in deze browser.", "error");
    return;
  }

  function paint(): void {
    if (!ctx || !img.complete || img.naturalWidth === 0) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, photo.width, photo.height);
    for (const r of regions) {
      if (!r.on) continue;
      const [x1, y1, x2, y2] = expandBox(r.box, pad);
      const sx = Math.floor(x1 * photo.width);
      const sy = Math.floor(y1 * photo.height);
      const w = Math.max(1, Math.ceil((x2 - x1) * photo.width));
      const hh = Math.max(1, Math.ceil((y2 - y1) * photo.height));
      if (effect === "fill") {
        ctx.fillStyle = "#1c1c1c";
        ctx.fillRect(sx, sy, w, hh);
      } else {
        const block = pixelBlock(w, hh);
        const tw = Math.max(1, Math.round(w / block));
        const th = Math.max(1, Math.round(hh / block));
        const tmp = document.createElement("canvas");
        tmp.width = tw;
        tmp.height = th;
        const tctx = tmp.getContext("2d");
        if (!tctx) continue;
        tctx.drawImage(canvas, sx, sy, w, hh, 0, 0, tw, th);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tw, th, sx, sy, w, hh);
        ctx.imageSmoothingEnabled = true;
      }
    }
    renderOverlay();
  }

  function renderOverlay(): void {
    overlay.replaceChildren();
    for (const r of regions) {
      if (!r.on) continue;
      const [x1, y1, x2, y2] = expandBox(r.box, pad);
      overlay.append(h("div", { class: "mask-box", style: { left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` } }));
    }
    if (drawing) {
      const b = normalizeBox(drawing.start, drawing.current, 0);
      if (b) overlay.append(h("div", { class: "mask-box mask-box--draft", style: { left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` } }));
    }
  }

  function renderList(): void {
    list.replaceChildren(
      ...(regions.length === 0
        ? [h("div", { class: "empty small" }, "Geen aanwijzingen met een kader. Teken zelf een vlak op de foto.")]
        : regions.map((r) =>
            h("label", { class: "item", style: { display: "flex", gap: "10px", alignItems: "flex-start" } }, [
              h("input", {
                type: "checkbox",
                checked: r.on,
                onchange: (e: Event) => {
                  r.on = (e.target as HTMLInputElement).checked;
                  paint();
                }
              }),
              h("span", { class: "small", style: { flex: "1" } }, r.label),
              r.manual
                ? h("button", { class: "btn btn--ghost", onclick: (e: Event) => { e.preventDefault(); regions.splice(regions.indexOf(r), 1); renderList(); paint(); } }, "Weg")
                : null
            ])
          ))
    );
  }

  // Zelf een vlak tekenen met de muis of het scherm.
  const point = (e: PointerEvent): [number, number] => {
    const rect = overlay.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  };
  overlay.addEventListener("pointerdown", (e) => {
    overlay.setPointerCapture(e.pointerId);
    const p = point(e);
    drawing = { start: p, current: p };
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    drawing.current = point(e);
    renderOverlay();
  });
  overlay.addEventListener("pointerup", () => {
    if (!drawing) return;
    const b = normalizeBox(drawing.start, drawing.current);
    drawing = null;
    if (b) {
      counter++;
      regions.push({ id: `manual-${counter}`, label: `Eigen vlak ${counter}`, box: b, on: true, manual: true });
      renderList();
    }
    paint();
  });

  const effectSelect = h(
    "select",
    { onchange: (e: Event) => { effect = (e.target as HTMLSelectElement).value as Effect; paint(); } },
    h("option", { value: "pixel" }, "Pixeleren (onleesbaar maken)"),
    h("option", { value: "fill" }, "Donker vlak")
  );
  const padInput = h("input", {
    type: "range",
    min: "0",
    max: "0.6",
    step: "0.05",
    value: String(pad),
    oninput: (e: Event) => { pad = Number((e.target as HTMLInputElement).value); paint(); }
  });

  let close: () => void = () => undefined;
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      paint();
      const blob = await finalizeJpeg(await canvasToJpeg(canvas, 0.92));
      await api(`/api/photos/${photo.id}/masked`, { method: "PUT", body: blob });
      toast("Bewerkte foto opgeslagen. Analyseer nu de variant 'Bewerkte foto' en keur die goed.", "ok", 9000);
      close();
      onSaved();
    } catch (error) {
      toast((error as Error).message, "error");
      saveBtn.disabled = false;
    }
  });

  close = openModal(
    h("div", { class: "stack mask-editor" }, [
      h("h2", null, "Onzichtbaar maken"),
      h("p", { class: "muted small" }, "Vink aan wat afgedekt moet worden of sleep over de foto om zelf een vlak te tekenen. De bewerkte foto krijgt dezelfde afmetingen als het origineel."),
      stage,
      h("div", { class: "two-col", style: { gap: "10px" } }, [h("label", { class: "field" }, ["Effect", effectSelect]), h("label", { class: "field" }, ["Marge rond de vlakken", padInput])]),
      list,
      h("div", { class: "row" }, [saveBtn, h("button", { class: "btn btn--ghost", onclick: () => close() }, "Annuleren")])
    ])
  );

  img.onload = () => {
    paint();
  };
  img.src = photoUrl(photo.id);
  renderList();
}
