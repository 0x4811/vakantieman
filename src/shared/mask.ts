// Hulpfuncties voor het onzichtbaar maken van details op een foto.

import { clamp } from "./geo";
import type { Box } from "./types";

/** Vergroot een kader met `pad` (aandeel van de kleinste zijde van het kader) en houdt het binnen de foto. */
export function expandBox(box: Box, pad: number): Box {
  const [x1, y1, x2, y2] = box;
  const margin = Math.max(0, pad) * Math.min(x2 - x1, y2 - y1);
  return [clamp(x1 - margin, 0, 1), clamp(y1 - margin, 0, 1), clamp(x2 + margin, 0, 1), clamp(y2 + margin, 0, 1)];
}

/** Sorteert de hoeken en begrenst op de foto; geeft null bij een te klein kader. */
export function normalizeBox(a: [number, number], b: [number, number], minSize = 0.01): Box | null {
  const x1 = clamp(Math.min(a[0], b[0]), 0, 1);
  const x2 = clamp(Math.max(a[0], b[0]), 0, 1);
  const y1 = clamp(Math.min(a[1], b[1]), 0, 1);
  const y2 = clamp(Math.max(a[1], b[1]), 0, 1);
  return x2 - x1 < minSize || y2 - y1 < minSize ? null : [x1, y1, x2, y2];
}

/** Blokgrootte voor pixeleren: groot genoeg dat tekst en details onleesbaar worden. */
export function pixelBlock(widthPx: number, heightPx: number): number {
  return Math.max(10, Math.round(Math.min(widthPx, heightPx) / 5));
}
