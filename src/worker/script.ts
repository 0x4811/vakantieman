// Bouwt het sessiescript uit D1. Het script bevat alleen wat het publiek mag zien:
// geen verborgen aanwijzingen of kandidaten, en alles afgerond op het detailniveau van de foto.

import { applyRevealLevel, placeLabel, publicPoint } from "../shared/levels";
import type { ScriptAnalysis, SessionScript } from "../shared/session";
import type { Analysis } from "../shared/types";
import { getAnalysis, getPhoto, type AnalysisRow, type SessionRow } from "./db";
import type { Env } from "./env";

function toScriptAnalysis(row: AnalysisRow, level: Parameters<typeof applyRevealLevel>[1]): ScriptAnalysis {
  const limited = applyRevealLevel(JSON.parse(row.result_json) as Analysis, level);
  const clues = limited.clues.filter((c) => !c.hidden);
  const ids = new Set(clues.map((c) => c.id));
  const candidates = limited.candidates
    .filter((c) => !c.hidden)
    .map((c) => ({ ...c, supporting_clue_ids: c.supporting_clue_ids.filter((id) => ids.has(id)) }));
  return {
    summary: limited.summary,
    overall_confidence: limited.overall_confidence,
    provider: row.provider,
    model: row.model,
    clues,
    candidates
  };
}

export type BuildResult = { ok: true; script: SessionScript } | { ok: false; error: string };

export async function buildScript(env: Env, session: SessionRow): Promise<BuildResult> {
  const photo = await getPhoto(env.DB, session.photo_id);
  if (!photo) return { ok: false, error: "De foto van deze sessie bestaat niet meer." };
  const analysis = await getAnalysis(env.DB, session.analysis_id);
  if (!analysis) return { ok: false, error: "De analyse van deze sessie bestaat niet meer." };
  const masked = session.masked_analysis_id ? await getAnalysis(env.DB, session.masked_analysis_id) : null;

  const point = publicPoint(photo.true_lat, photo.true_lon, photo.reveal_level);
  const base = env.PUBLIC_VOTE_URL ? env.PUBLIC_VOTE_URL.replace(/\/+$/, "") : null;

  return {
    ok: true,
    script: {
      code: session.code,
      photo: {
        id: photo.id,
        label: photo.label,
        width: photo.width,
        height: photo.height,
        reveal_level: photo.reveal_level,
        truth: { ...point, place: photo.true_place }
      },
      analysis: toScriptAnalysis(analysis, photo.reveal_level),
      masked: masked && photo.masked_r2_key ? toScriptAnalysis(masked, photo.reveal_level) : null,
      vote_url: base ? `${base}/v/${session.code}` : null
    }
  };
}

export { placeLabel };
