// Sessie: script, toestandsmachine, aanwijzingsweergave en scoreberekening.
// Pure functies zonder omgevingsafhankelijkheden. De Durable Object (live) en de
// offline-speler gebruiken precies dezelfde code, zodat ze zich identiek gedragen.

import { clamp, haversineKm, median } from "./geo";
import type { Candidate, Clue, RevealLevel } from "./types";

export const PHASES = ["idle", "guessing", "analysis", "reveal", "lesson", "masked", "done"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  idle: "Start",
  guessing: "Raadronde",
  analysis: "Analyse",
  reveal: "Onthulling",
  lesson: "De les",
  masked: "Onzichtbaar",
  done: "Afsluiting"
};

export interface ScriptAnalysis {
  summary: string;
  overall_confidence: number;
  provider: string;
  model: string;
  clues: Clue[];
  candidates: Candidate[];
}

export interface SessionScript {
  code: string;
  photo: {
    id: string;
    label: string;
    width: number;
    height: number;
    reveal_level: RevealLevel;
    /** Punt zoals het publiek het mag zien (al afgerond op het detailniveau). */
    truth: { lat: number; lon: number; radius_km: number; place: string };
  };
  analysis: ScriptAnalysis;
  masked: ScriptAnalysis | null;
  /** Volledige URL van de stempagina, voor de QR-code. */
  vote_url: string | null;
}

export interface SessionState {
  phase: Phase;
  /** Teller binnen de fase: aantal getoonde aanwijzingen (analyse, les) of 0/1 (onzichtbaar). */
  step: number;
  votesOpen: boolean;
  blank: boolean;
  ended: boolean;
}

export type Action =
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; phase: Phase }
  | { type: "votes"; open: boolean }
  | { type: "blank"; on?: boolean }
  | { type: "reset" }
  | { type: "end" };

export interface ScriptCounts {
  clues: number;
  lessonItems: number;
  hasMasked: boolean;
}

/** Aanwijzingen die in de les aan bod komen: alleen die met een tip. */
export function lessonClues(script: Pick<SessionScript, "analysis">): Clue[] {
  return script.analysis.clues.filter((c) => c.leak_advice.trim() !== "");
}

export function scriptCounts(script: SessionScript): ScriptCounts {
  return {
    clues: script.analysis.clues.length,
    lessonItems: lessonClues(script).length,
    hasMasked: script.masked !== null
  };
}

export const initialState = (): SessionState => ({
  phase: "idle",
  step: 0,
  votesOpen: false,
  blank: false,
  ended: false
});

const at = (phase: Phase, step = 0, votesOpen = false): Pick<SessionState, "phase" | "step" | "votesOpen"> => ({
  phase,
  step,
  votesOpen
});

function afterLesson(counts: ScriptCounts): Pick<SessionState, "phase" | "step" | "votesOpen"> {
  return counts.hasMasked ? at("masked") : at("done");
}

function enter(state: SessionState, phase: Phase, counts: ScriptCounts): SessionState {
  if (phase === "masked" && !counts.hasMasked) return state;
  // Alleen vanaf de startpagina gaan de stemmen automatisch open.
  const votesOpen = phase === "guessing" && state.phase === "idle";
  return { ...state, ...at(phase, 0, votesOpen) };
}

function next(state: SessionState, counts: ScriptCounts): SessionState {
  switch (state.phase) {
    case "idle":
      return { ...state, ...at("guessing", 0, true) };
    case "guessing":
      return { ...state, ...at("analysis") };
    case "analysis":
      return state.step < counts.clues ? { ...state, step: state.step + 1 } : { ...state, ...at("reveal") };
    case "reveal":
      return counts.lessonItems > 0 ? { ...state, ...at("lesson") } : { ...state, ...afterLesson(counts) };
    case "lesson":
      return state.step < counts.lessonItems ? { ...state, step: state.step + 1 } : { ...state, ...afterLesson(counts) };
    case "masked":
      return state.step < 1 ? { ...state, step: 1 } : { ...state, ...at("done") };
    case "done":
      return state;
  }
}

function prev(state: SessionState, counts: ScriptCounts): SessionState {
  switch (state.phase) {
    case "idle":
      return state;
    case "guessing":
      return { ...state, ...at("idle") };
    case "analysis":
      return state.step > 0 ? { ...state, step: state.step - 1 } : { ...state, ...at("guessing") };
    case "reveal":
      return { ...state, ...at("analysis", counts.clues) };
    case "lesson":
      return state.step > 0 ? { ...state, step: state.step - 1 } : { ...state, ...at("reveal") };
    case "masked":
      return state.step > 0
        ? { ...state, step: 0 }
        : counts.lessonItems > 0
          ? { ...state, ...at("lesson", counts.lessonItems) }
          : { ...state, ...at("reveal") };
    case "done":
      return counts.hasMasked
        ? { ...state, ...at("masked", 1) }
        : counts.lessonItems > 0
          ? { ...state, ...at("lesson", counts.lessonItems) }
          : { ...state, ...at("reveal") };
  }
}

export function reduce(state: SessionState, action: Action, counts: ScriptCounts): SessionState {
  // Na afsluiten is alleen nog het zwarte scherm te bedienen.
  if (state.ended && action.type !== "blank") return state;
  switch (action.type) {
    case "blank":
      return { ...state, blank: action.on ?? !state.blank };
    case "votes":
      return state.phase === "guessing" ? { ...state, votesOpen: action.open } : state;
    case "reset":
      return initialState();
    case "end":
      return { ...state, ...at("done"), ended: true };
    case "goto":
      return enter(state, action.phase, counts);
    case "next":
      return next(state, counts);
    case "prev":
      return prev(state, counts);
  }
}

/** Is dit een geldige actie van een client? (De DO controleert hiermee binnenkomende berichten.) */
export function isAction(value: unknown): value is Action {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "next":
    case "prev":
    case "reset":
    case "end":
      return true;
    case "goto":
      return typeof v.phase === "string" && (PHASES as readonly string[]).includes(v.phase);
    case "votes":
      return typeof v.open === "boolean";
    case "blank":
      return v.on === undefined || typeof v.on === "boolean";
    default:
      return false;
  }
}

// ---------------------------------------------------------------- analyseweergave

export interface AreaView {
  id: string;
  lat: number;
  lon: number;
  radius_km: number;
  /** 0..1: hoeveel van de ondersteunende aanwijzingen al is onthuld. */
  strength: number;
  confidence: number;
  primary: boolean;
  place: string;
}

export interface AnalysisView {
  revealedClueIds: string[];
  focusClueId: string | null;
  areas: AreaView[];
  complete: boolean;
}

/**
 * Wat er na `step` onthulde aanwijzingen te zien is. Kandidaten worden zichtbaar en sterker
 * naarmate meer van hun ondersteunende aanwijzingen zijn onthuld: het warm-warmer-heet-effect.
 */
export function analysisView(
  analysis: Pick<ScriptAnalysis, "clues" | "candidates">,
  step: number,
  label: (c: Candidate) => string
): AnalysisView {
  const total = analysis.clues.length;
  const k = clamp(step, 0, total);
  const revealed = analysis.clues.slice(0, k).map((c) => c.id);
  const revealedSet = new Set(revealed);
  const known = new Set(analysis.clues.map((c) => c.id));

  const areas: AreaView[] = [];
  analysis.candidates.forEach((cand, index) => {
    const support = cand.supporting_clue_ids.filter((id) => known.has(id));
    const strength =
      support.length === 0 ? (k === total ? 1 : 0) : support.filter((id) => revealedSet.has(id)).length / support.length;
    if (strength <= 0) return;
    areas.push({
      id: cand.id,
      lat: cand.lat,
      lon: cand.lon,
      radius_km: cand.radius_km,
      strength,
      confidence: cand.confidence,
      primary: index === 0,
      place: label(cand)
    });
  });

  return { revealedClueIds: revealed, focusClueId: revealed[revealed.length - 1] ?? null, areas, complete: k === total };
}

// ---------------------------------------------------------------- scores

export interface Vote {
  lat: number;
  lon: number;
}

export interface DistanceBucket {
  label: string;
  max_km: number;
  count: number;
}

export interface RevealResults {
  votes: number;
  median_km: number | null;
  closest_km: number | null;
  /** [lon, lat] van de dichtstbijzijnde gok. */
  closest_point: [number, number] | null;
  tool_km: number | null;
  /** [lon, lat] van de keuze van de tool. */
  tool_point: [number, number] | null;
  masked_tool_km: number | null;
  buckets: DistanceBucket[];
}

const BUCKETS: { label: string; max_km: number }[] = [
  { label: "binnen 10 km", max_km: 10 },
  { label: "binnen 100 km", max_km: 100 },
  { label: "binnen 1.000 km", max_km: 1000 },
  { label: "binnen 5.000 km", max_km: 5000 },
  { label: "verder weg", max_km: Number.POSITIVE_INFINITY }
];

export function computeResults(
  votes: Vote[],
  truth: { lat: number; lon: number },
  tool: { lat: number; lon: number } | null,
  maskedTool: { lat: number; lon: number } | null
): RevealResults {
  const distances = votes.map((v) => haversineKm(v.lat, v.lon, truth.lat, truth.lon));
  let closestIndex = -1;
  distances.forEach((d, i) => {
    if (closestIndex === -1 || d < distances[closestIndex]) closestIndex = i;
  });

  const buckets: DistanceBucket[] = BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const d of distances) {
    const bucket = buckets.find((b) => d <= b.max_km) ?? buckets[buckets.length - 1];
    bucket.count++;
  }

  return {
    votes: votes.length,
    median_km: median(distances),
    closest_km: closestIndex === -1 ? null : distances[closestIndex],
    closest_point: closestIndex === -1 ? null : [votes[closestIndex].lon, votes[closestIndex].lat],
    tool_km: tool ? haversineKm(tool.lat, tool.lon, truth.lat, truth.lon) : null,
    tool_point: tool ? [tool.lon, tool.lat] : null,
    masked_tool_km: maskedTool ? haversineKm(maskedTool.lat, maskedTool.lon, truth.lat, truth.lon) : null,
    buckets: buckets.map((b) => ({ ...b, max_km: Number.isFinite(b.max_km) ? b.max_km : 40075 }))
  };
}

/** Keuze van de tool: de eerste (hoogste) kandidaat. */
export function topCandidate(analysis: Pick<ScriptAnalysis, "candidates"> | null): { lat: number; lon: number } | null {
  const c = analysis?.candidates[0];
  return c ? { lat: c.lat, lon: c.lon } : null;
}

// ---------------------------------------------------------------- berichten (WebSocket)

export type ServerMessage =
  | {
      t: "snapshot";
      script: SessionScript;
      state: SessionState;
      votes: [number, number][];
      vote_count: number;
      results: RevealResults | null;
      clients: ClientCounts;
    }
  | { t: "state"; state: SessionState; results: RevealResults | null }
  | { t: "votes"; points: [number, number][]; count: number }
  | { t: "clients"; clients: ClientCounts }
  | { t: "error"; message: string };

export interface ClientCounts {
  present: number;
  control: number;
}

export type ClientMessage = { t: "action"; action: Action };

export const MAX_VOTES = 3000;
export const MAX_VOTE_CHANGES = 5;
export const VOTE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
