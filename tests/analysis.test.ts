import { describe, expect, it } from "vitest";
import { AnalysisParseError, extractJson, normalizeAnalysis, toBox } from "../src/shared/analysis";

const pixels = { boxFormat: "pixels_xyxy", width: 1000, height: 500 } as const;
const norm = { boxFormat: "norm1000_yxyx", width: 1000, height: 500 } as const;

describe("extractJson", () => {
  it("haalt JSON uit codeblokken en omringende tekst", () => {
    expect(extractJson('Hier: ```json\n{"a":1}\n``` klaar')).toEqual({ a: 1 });
    expect(extractJson('tekst {"a":{"b":2}} nog meer')).toEqual({ a: { b: 2 } });
  });
  it("geeft een duidelijke fout bij onzin", () => {
    expect(() => extractJson("geen json")).toThrow(AnalysisParseError);
    expect(() => extractJson("{kapot")).toThrow(AnalysisParseError);
  });
});

describe("toBox", () => {
  it("rekent pixelkaders om naar 0..1", () => {
    expect(toBox([100, 50, 500, 250], pixels)).toEqual([0.1, 0.1, 0.5, 0.5]);
  });
  it("rekent Gemini-kaders [ymin, xmin, ymax, xmax] op schaal 1000 om", () => {
    expect(toBox([100, 200, 500, 800], norm)).toEqual([0.2, 0.1, 0.8, 0.5]);
  });
  it("wisselt omgekeerde hoeken om en verwerpt onzin", () => {
    expect(toBox([500, 250, 100, 50], pixels)).toEqual([0.1, 0.1, 0.5, 0.5]);
    expect(toBox([0, 0, 5000, 5000], pixels)).toBeNull();
    expect(toBox([], pixels)).toBeNull();
    expect(toBox([1, 2, 3], pixels)).toBeNull();
    expect(toBox(["a", 1, 2, 3], pixels)).toBeNull();
    expect(toBox([10, 10, 11, 11], pixels)).toBeNull(); // te klein
  });
});

describe("normalizeAnalysis", () => {
  const raw = {
    summary: "  Samenvatting\n met   witruimte ",
    overall_confidence: 1.7,
    clues: [
      { category: "taal", description: "Bord", box: [100, 50, 500, 250], confidence: 0.9, leak_advice: "Niet tonen" },
      { category: "onbekend", description: "Gevel", box: [], confidence: "0.4", leak_advice: "" },
      { category: "taal", description: "", box: [], confidence: 0.5, leak_advice: "" }
    ],
    candidates: [
      { country: "NL", city: "A", district: "", street: "", lat: 52.37, lon: 4.9, radius_km: 5, confidence: 0.2, reasoning: "r1", supporting_clues: [1] },
      { country: "BE", city: "B", district: "", street: "", lat: 51.2, lon: 4.4, radius_km: 2, confidence: 0.8, reasoning: "r2", supporting_clues: [1, 2, 3, 99] },
      { country: "XX", city: "kapot", district: "", street: "", lat: 200, lon: 4, radius_km: 2, confidence: 0.9, reasoning: "r3", supporting_clues: [] }
    ]
  };

  it("normaliseert tekst, vertrouwen, categorieën en kaders", () => {
    const a = normalizeAnalysis(raw, pixels);
    expect(a.summary).toBe("Samenvatting met witruimte");
    expect(a.overall_confidence).toBe(1);
    expect(a.clues).toHaveLength(2);
    expect(a.clues[0].box).toEqual([0.1, 0.1, 0.5, 0.5]);
    expect(a.clues[1].category).toBe("overig");
    expect(a.clues[1].confidence).toBe(0.4);
    expect(a.clues[1].box).toBeNull();
  });

  it("sorteert kandidaten, verwerpt ongeldige coördinaten en koppelt aanwijzingen", () => {
    const a = normalizeAnalysis(raw, pixels);
    expect(a.candidates.map((c) => c.country)).toEqual(["BE", "NL"]);
    expect(a.candidates[0].id).toBe("k1");
    // Aanwijzing 3 is weggefilterd (lege beschrijving) en 99 bestaat niet.
    expect(a.candidates[0].supporting_clue_ids).toEqual(["c1", "c2"]);
  });

  it("staat een lege kandidatenlijst toe (model kan niets vaststellen)", () => {
    const a = normalizeAnalysis({ summary: "Onvoldoende aanwijzingen", overall_confidence: 0.05, clues: [], candidates: [] }, pixels);
    expect(a.candidates).toEqual([]);
    expect(a.overall_confidence).toBe(0.05);
  });

  it("weigert iets dat geen object is", () => {
    expect(() => normalizeAnalysis("nee", pixels)).toThrow(AnalysisParseError);
    expect(() => normalizeAnalysis(null, pixels)).toThrow(AnalysisParseError);
  });
});
