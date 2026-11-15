import { describe, expect, it } from "vitest";
import { expandBox, normalizeBox, pixelBlock } from "../src/shared/mask";

describe("onzichtbaar maken", () => {
  it("vergroot een kader en blijft binnen de foto", () => {
    const [x1, y1, x2, y2] = expandBox([0.4, 0.4, 0.6, 0.5], 0.5);
    expect(x1).toBeCloseTo(0.35);
    expect(y1).toBeCloseTo(0.35);
    expect(x2).toBeCloseTo(0.65);
    expect(y2).toBeCloseTo(0.55);
    expect(expandBox([0, 0, 0.1, 0.1], 5)).toEqual([0, 0, 0.6, 0.6]);
  });

  it("zonder marge blijft het kader gelijk", () => {
    expect(expandBox([0.2, 0.2, 0.4, 0.4], 0)).toEqual([0.2, 0.2, 0.4, 0.4]);
  });

  it("normaliseert getekende kaders, in elke trekrichting", () => {
    expect(normalizeBox([0.6, 0.7], [0.2, 0.3])).toEqual([0.2, 0.3, 0.6, 0.7]);
    expect(normalizeBox([-1, 0.2], [2, 0.5])).toEqual([0, 0.2, 1, 0.5]);
  });

  it("negeert een te klein kader", () => {
    expect(normalizeBox([0.5, 0.5], [0.505, 0.7])).toBeNull();
  });

  it("pixeleert grof genoeg om tekst onleesbaar te maken", () => {
    expect(pixelBlock(200, 100)).toBe(20);
    expect(pixelBlock(30, 30)).toBe(10);
  });
});
