// Schema, parser en normalisatie van de uitvoer van beeldmodellen.
// Elke provider levert (bijna) hetzelfde ruwe formaat; hier wordt het
// omgezet naar het gemeenschappelijke `Analysis`-formaat en gevalideerd.

import { clamp, isValidLatLon } from "./geo";
import { CLUE_CATEGORIES, type Analysis, type Box, type Candidate, type Clue, type ClueCategory } from "./types";

export const MAX_CLUES = 12;
export const MAX_CANDIDATES = 5;

export class AnalysisParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisParseError";
  }
}

/** JSON-schema voor gestructureerde uitvoer (gebruikt door de Claude-adapter). */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    overall_confidence: { type: "number" },
    clues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...CLUE_CATEGORIES] },
          description: { type: "string" },
          box: { type: "array", items: { type: "number" } },
          confidence: { type: "number" },
          leak_advice: { type: "string" }
        },
        required: ["category", "description", "box", "confidence", "leak_advice"],
        additionalProperties: false
      }
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          country: { type: "string" },
          city: { type: "string" },
          district: { type: "string" },
          street: { type: "string" },
          lat: { type: "number" },
          lon: { type: "number" },
          radius_km: { type: "number" },
          confidence: { type: "number" },
          reasoning: { type: "string" },
          supporting_clues: { type: "array", items: { type: "integer" } }
        },
        required: [
          "country",
          "city",
          "district",
          "street",
          "lat",
          "lon",
          "radius_km",
          "confidence",
          "reasoning",
          "supporting_clues"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "overall_confidence", "clues", "candidates"],
  additionalProperties: false
} as const;

/** Haalt het eerste JSON-object uit tekst, ook als het in een codeblok staat. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AnalysisParseError("Er stond geen JSON in het antwoord van het model.");
  }
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new AnalysisParseError("Het antwoord van het model was geen geldige JSON.");
  }
}

export interface NormalizeOptions {
  /** Hoe het model kaders teruggeeft. */
  boxFormat: "pixels_xyxy" | "norm1000_yxyx";
  /** Afmetingen van de afbeelding zoals naar het model gestuurd. */
  width: number;
  height: number;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function toBox(value: unknown, opts: NormalizeOptions): Box | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const n = value.map((v) => num(v));
  if (n.some((v) => v === null)) return null;
  const [a, b, c, d] = n as number[];

  let x1: number, y1: number, x2: number, y2: number;
  if (opts.boxFormat === "pixels_xyxy") {
    if (opts.width <= 0 || opts.height <= 0) return null;
    [x1, y1, x2, y2] = [a / opts.width, b / opts.height, c / opts.width, d / opts.height];
  } else {
    // Gemini-stijl: [ymin, xmin, ymax, xmax] op een schaal van 0 tot 1000.
    [y1, x1, y2, x2] = [a / 1000, b / 1000, c / 1000, d / 1000];
  }

  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];

  const tolerance = 0.05;
  if (x1 < -tolerance || y1 < -tolerance || x2 > 1 + tolerance || y2 > 1 + tolerance) return null;

  x1 = clamp(x1, 0, 1);
  y1 = clamp(y1, 0, 1);
  x2 = clamp(x2, 0, 1);
  y2 = clamp(y2, 0, 1);
  if (x2 - x1 < 0.01 || y2 - y1 < 0.01) return null;

  return [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)];
}

export function normalizeAnalysis(raw: unknown, opts: NormalizeOptions): Analysis {
  if (!isRecord(raw)) throw new AnalysisParseError("Het antwoord van het model had niet de verwachte vorm.");

  const rawClues = (Array.isArray(raw.clues) ? raw.clues : []).slice(0, MAX_CLUES);
  const clues: Clue[] = [];
  rawClues.forEach((item, index) => {
    if (!isRecord(item)) return;
    const description = str(item.description, 300);
    if (!description) return;
    const category = (CLUE_CATEGORIES as readonly string[]).includes(String(item.category))
      ? (item.category as ClueCategory)
      : "overig";
    clues.push({
      id: `c${index + 1}`,
      category,
      description,
      box: toBox(item.box, opts),
      confidence: clamp(num(item.confidence) ?? 0.5, 0, 1),
      leak_advice: str(item.leak_advice, 300)
    });
  });

  const clueIds = new Set(clues.map((c) => c.id));

  const rawCandidates = (Array.isArray(raw.candidates) ? raw.candidates : []).filter(isRecord);
  const candidates: Candidate[] = [];
  for (const item of rawCandidates) {
    const lat = num(item.lat);
    const lon = num(item.lon);
    if (lat === null || lon === null || !isValidLatLon(lat, lon)) continue;
    const supporting = (Array.isArray(item.supporting_clues) ? item.supporting_clues : [])
      .map((v) => num(v))
      .filter((v): v is number => v !== null)
      .map((v) => `c${Math.trunc(v)}`)
      .filter((id) => clueIds.has(id));
    candidates.push({
      id: "",
      country: str(item.country, 80),
      city: str(item.city, 80),
      district: str(item.district, 80),
      street: str(item.street, 120),
      lat,
      lon,
      radius_km: clamp(num(item.radius_km) ?? 25, 0.05, 6000),
      confidence: clamp(num(item.confidence) ?? 0.3, 0, 1),
      reasoning: str(item.reasoning, 500),
      supporting_clue_ids: [...new Set(supporting)]
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates.slice(0, MAX_CANDIDATES);
  top.forEach((c, i) => {
    c.id = `k${i + 1}`;
  });

  const overall =
    num(raw.overall_confidence) ?? (top.length > 0 ? top[0].confidence : 0);

  return {
    summary: str(raw.summary, 600),
    overall_confidence: clamp(overall, 0, 1),
    clues,
    candidates: top
  };
}
