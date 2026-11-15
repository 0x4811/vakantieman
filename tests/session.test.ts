import { describe, expect, it } from "vitest";
import {
  analysisView,
  computeResults,
  initialState,
  isAction,
  lessonClues,
  reduce,
  scriptCounts,
  topCandidate,
  type Action,
  type ScriptAnalysis,
  type ScriptCounts,
  type SessionScript,
  type SessionState
} from "../src/shared/session";
import { sampleAnalysis } from "./helpers";

const counts = (over: Partial<ScriptCounts> = {}): ScriptCounts => ({
  clues: 3,
  lessonItems: 2,
  hasMasked: true,
  ...over
});

function run(actions: Action[], c: ScriptCounts = counts(), from: SessionState = initialState()): SessionState {
  return actions.reduce((s, a) => reduce(s, a, c), from);
}

const next: Action = { type: "next" };
const prev: Action = { type: "prev" };
const repeat = (a: Action, n: number): Action[] => Array.from({ length: n }, () => a);

describe("toestandsmachine", () => {
  it("start op de startpagina met gesloten stemmen", () => {
    expect(initialState()).toEqual({ phase: "idle", step: 0, votesOpen: false, blank: false, ended: false });
  });

  it("opent de stemmen bij het begin van de raadronde en sluit ze bij de analyse", () => {
    const guessing = run([next]);
    expect(guessing).toMatchObject({ phase: "guessing", votesOpen: true });
    const analysis = run([next, next]);
    expect(analysis).toMatchObject({ phase: "analysis", step: 0, votesOpen: false });
  });

  it("doorloopt alle fasen met onzichtbaar-stap", () => {
    const c = counts();
    // idle -> guessing -> analysis(0) -> 3 aanwijzingen -> reveal -> lesson(0) -> 2 tips -> masked(0) -> masked(1) -> done
    const phases: string[] = [];
    let s = initialState();
    for (let i = 0; i < 20; i++) {
      phases.push(`${s.phase}:${s.step}`);
      const n = reduce(s, next, c);
      if (n === s) break;
      s = n;
    }
    expect(phases).toEqual([
      "idle:0",
      "guessing:0",
      "analysis:0",
      "analysis:1",
      "analysis:2",
      "analysis:3",
      "reveal:0",
      "lesson:0",
      "lesson:1",
      "lesson:2",
      "masked:0",
      "masked:1",
      "done:0"
    ]);
  });

  it("slaat de les over zonder tips en de onzichtbaar-fase zonder bewerkte foto", () => {
    const c = counts({ lessonItems: 0, hasMasked: false });
    const s = run([...repeat(next, 2 + 3 + 1)], c); // idle→guessing→analysis0, stappen 1..3, reveal
    expect(s.phase).toBe("reveal");
    expect(reduce(s, next, c)).toMatchObject({ phase: "done" });
  });

  it("gaat van de les rechtstreeks naar het einde zonder bewerkte foto", () => {
    const c = counts({ hasMasked: false });
    const lesson = run([...repeat(next, 7), next, next], c);
    expect(lesson).toMatchObject({ phase: "lesson", step: 2 });
    expect(reduce(lesson, next, c)).toMatchObject({ phase: "done" });
  });

  it("is aan het einde stabiel", () => {
    const done = run([{ type: "goto", phase: "done" }]);
    expect(reduce(done, next, counts())).toBe(done);
  });

  it("prev is de inverse van next langs het hele pad", () => {
    for (const c of [counts(), counts({ hasMasked: false }), counts({ lessonItems: 0 }), counts({ lessonItems: 0, hasMasked: false }), counts({ clues: 0 })]) {
      const path: SessionState[] = [initialState()];
      for (let i = 0; i < 40; i++) {
        const n = reduce(path[path.length - 1], next, c);
        if (n === path[path.length - 1]) break;
        path.push(n);
      }
      // Terug lopen levert dezelfde toestanden op, behalve dat de stemmen bij terugkeer naar
      // de raadronde dicht blijven (alleen vanaf de startpagina gaan ze automatisch open).
      let s = path[path.length - 1];
      for (let i = path.length - 2; i >= 0; i--) {
        s = reduce(s, prev, c);
        expect({ phase: s.phase, step: s.step }).toEqual({ phase: path[i].phase, step: path[i].step });
      }
    }
  });

  it("prev op de startpagina doet niets", () => {
    const s = initialState();
    expect(reduce(s, prev, counts())).toBe(s);
  });

  it("open en dicht zetten van stemmen kan alleen tijdens de raadronde", () => {
    const g = run([next]);
    expect(reduce(g, { type: "votes", open: false }, counts()).votesOpen).toBe(false);
    expect(reduce({ ...g, votesOpen: false }, { type: "votes", open: true }, counts()).votesOpen).toBe(true);
    const a = run([next, next]);
    expect(reduce(a, { type: "votes", open: true }, counts()).votesOpen).toBe(false);
  });

  it("gaat bij terugkeren naar de raadronde niet vanzelf weer stemmen openen", () => {
    const back = run([next, next, prev]);
    expect(back).toMatchObject({ phase: "guessing", votesOpen: false });
  });

  it("goto naar de raadronde vanaf een andere fase laat de stemmen gesloten", () => {
    const s = run([{ type: "goto", phase: "reveal" }, { type: "goto", phase: "guessing" }]);
    expect(s).toMatchObject({ phase: "guessing", votesOpen: false });
  });

  it("goto naar onzichtbaar wordt genegeerd zonder bewerkte foto", () => {
    const c = counts({ hasMasked: false });
    const s = initialState();
    expect(reduce(s, { type: "goto", phase: "masked" }, c)).toBe(s);
  });

  it("zwart scherm schakelt en blijft ook na afsluiten bedienbaar", () => {
    const c = counts();
    expect(run([{ type: "blank" }]).blank).toBe(true);
    expect(run([{ type: "blank" }, { type: "blank" }]).blank).toBe(false);
    expect(run([{ type: "blank", on: true }, { type: "blank", on: true }]).blank).toBe(true);
    const ended = run([{ type: "end" }, { type: "blank", on: true }], c);
    expect(ended).toMatchObject({ ended: true, blank: true, phase: "done" });
  });

  it("na afsluiten zijn alle andere acties geblokkeerd", () => {
    const c = counts();
    const ended = run([{ type: "end" }], c);
    for (const a of [next, prev, { type: "reset" }, { type: "goto", phase: "idle" }, { type: "votes", open: true }] as Action[]) {
      expect(reduce(ended, a, c)).toBe(ended);
    }
  });

  it("reset zet alles terug", () => {
    const s = run([next, next, next, { type: "blank" }, { type: "reset" }]);
    expect(s).toEqual(initialState());
  });

  it("negeert next/prev niet stilletjes bij clues = 0", () => {
    const c = counts({ clues: 0 });
    const s = run([next, next], c);
    expect(s).toMatchObject({ phase: "analysis", step: 0 });
    expect(reduce(s, next, c)).toMatchObject({ phase: "reveal" });
  });
});

describe("isAction", () => {
  it("accepteert geldige acties", () => {
    for (const a of [
      { type: "next" },
      { type: "prev" },
      { type: "reset" },
      { type: "end" },
      { type: "goto", phase: "lesson" },
      { type: "votes", open: true },
      { type: "blank" },
      { type: "blank", on: false }
    ]) {
      expect(isAction(a)).toBe(true);
    }
  });

  it("weigert ongeldige invoer", () => {
    for (const a of [null, undefined, 5, "next", {}, { type: "boem" }, { type: "goto" }, { type: "goto", phase: "nergens" }, { type: "votes" }, { type: "votes", open: "ja" }, { type: "blank", on: "ja" }]) {
      expect(isAction(a)).toBe(false);
    }
  });
});

function scriptWith(analysis: ScriptAnalysis, masked: ScriptAnalysis | null): SessionScript {
  return {
    code: "ABCDE",
    photo: { id: "p", label: "Test", width: 100, height: 100, reveal_level: "city", truth: { lat: 51.2, lon: 4.4, radius_km: 10, place: "Antwerpen" } },
    analysis,
    masked,
    vote_url: null
  };
}

function scriptAnalysis(): ScriptAnalysis {
  const a = sampleAnalysis();
  return { summary: a.summary, overall_confidence: a.overall_confidence, provider: "mock", model: "mock-1", clues: a.clues, candidates: a.candidates };
}

describe("scriptCounts en lessonClues", () => {
  it("telt aanwijzingen, tips en bewerkte foto", () => {
    const base = scriptAnalysis();
    base.clues[1].leak_advice = "  ";
    expect(lessonClues({ analysis: base })).toHaveLength(1);
    expect(scriptCounts(scriptWith(base, null))).toEqual({ clues: 2, lessonItems: 1, hasMasked: false });
    expect(scriptCounts(scriptWith(base, scriptAnalysis()))).toMatchObject({ hasMasked: true });
  });
});

describe("analysisView", () => {
  const analysis = {
    clues: [
      { id: "a", category: "taal", description: "", box: null, confidence: 1, leak_advice: "" },
      { id: "b", category: "taal", description: "", box: null, confidence: 1, leak_advice: "" },
      { id: "c", category: "taal", description: "", box: null, confidence: 1, leak_advice: "" }
    ],
    candidates: [
      { id: "k1", country: "NL", city: "A", district: "", street: "", lat: 52, lon: 5, radius_km: 20, confidence: 0.8, reasoning: "", supporting_clue_ids: ["a", "b"] },
      { id: "k2", country: "BE", city: "B", district: "", street: "", lat: 51, lon: 4, radius_km: 30, confidence: 0.4, reasoning: "", supporting_clue_ids: ["c"] },
      { id: "k3", country: "DE", city: "C", district: "", street: "", lat: 50, lon: 8, radius_km: 40, confidence: 0.2, reasoning: "", supporting_clue_ids: [] }
    ]
  } satisfies Pick<ScriptAnalysis, "clues" | "candidates">;
  const label = (c: { city: string }) => c.city;

  it("toont niets voordat er een aanwijzing is onthuld", () => {
    const v = analysisView(analysis, 0, label);
    expect(v.areas).toEqual([]);
    expect(v.revealedClueIds).toEqual([]);
    expect(v.focusClueId).toBeNull();
    expect(v.complete).toBe(false);
  });

  it("laat kandidaten sterker worden naarmate hun aanwijzingen verschijnen", () => {
    const one = analysisView(analysis, 1, label);
    expect(one.areas.map((a) => [a.id, a.strength])).toEqual([["k1", 0.5]]);
    expect(one.focusClueId).toBe("a");
    const two = analysisView(analysis, 2, label);
    expect(two.areas.map((a) => [a.id, a.strength])).toEqual([["k1", 1]]);
    const three = analysisView(analysis, 3, label);
    expect(three.areas.map((a) => a.id)).toEqual(["k1", "k2", "k3"]);
    expect(three.complete).toBe(true);
    expect(three.areas[0].primary).toBe(true);
    expect(three.areas[1].primary).toBe(false);
  });

  it("begrenst de stap en gebruikt de labelfunctie", () => {
    const v = analysisView(analysis, 99, label);
    expect(v.revealedClueIds).toEqual(["a", "b", "c"]);
    expect(v.areas[0].place).toBe("A");
    expect(analysisView(analysis, -4, label).revealedClueIds).toEqual([]);
  });

  it("negeert onbekende ondersteunende aanwijzingen", () => {
    const odd = { clues: analysis.clues, candidates: [{ ...analysis.candidates[0], supporting_clue_ids: ["x"] }] };
    expect(analysisView(odd, 1, label).areas).toEqual([]);
    expect(analysisView(odd, 3, label).areas).toHaveLength(1);
  });
});

describe("computeResults", () => {
  const truth = { lat: 52.0, lon: 5.0 };

  it("geeft lege resultaten zonder stemmen", () => {
    const r = computeResults([], truth, { lat: 52, lon: 5 }, null);
    expect(r.votes).toBe(0);
    expect(r.median_km).toBeNull();
    expect(r.closest_km).toBeNull();
    expect(r.closest_point).toBeNull();
    expect(r.tool_km).toBeCloseTo(0, 5);
    expect(r.masked_tool_km).toBeNull();
    expect(r.buckets.reduce((n, b) => n + b.count, 0)).toBe(0);
  });

  it("berekent mediaan, dichtstbijzijnde gok en emmers", () => {
    const votes = [
      { lat: 52.0, lon: 5.05 }, // ~3,4 km
      { lat: 48.85, lon: 2.35 }, // Parijs, ~430 km
      { lat: 40.7, lon: -74 }, // New York, > 5.000 km
      { lat: 35.7, lon: 139.7 } // Tokio, > 5.000 km
    ];
    const r = computeResults(votes, truth, { lat: 52.1, lon: 5.1 }, { lat: 0, lon: 0 });
    expect(r.votes).toBe(4);
    expect(r.closest_km).toBeLessThan(5);
    expect(r.closest_point).toEqual([5.05, 52.0]);
    expect(r.median_km).toBeGreaterThan(400);
    expect(r.tool_km).toBeLessThan(15);
    expect(r.masked_tool_km).toBeGreaterThan(5000);
    expect(r.tool_point).toEqual([5.1, 52.1]);
    expect(r.buckets.map((b) => b.count)).toEqual([1, 0, 1, 0, 2]);
    expect(r.buckets[r.buckets.length - 1].max_km).toBe(40075);
  });

  it("topCandidate kiest de eerste kandidaat", () => {
    expect(topCandidate(null)).toBeNull();
    expect(topCandidate({ candidates: [] })).toBeNull();
    const a = scriptAnalysis();
    expect(topCandidate(a)).toEqual({ lat: a.candidates[0].lat, lon: a.candidates[0].lon });
  });
});
