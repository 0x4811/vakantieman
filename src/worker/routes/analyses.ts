// Opgeslagen analyses: ophalen, goedkeuren, verbergen van onderdelen, verwijderen.

import { Hono } from "hono";
import type { Analysis } from "../../shared/types";
import { getAnalysis, toAnalysisDto } from "../db";
import type { AppContext } from "../env";

export const analyses = new Hono<AppContext>();

analyses.get("/:id", async (c) => {
  const row = await getAnalysis(c.env.DB, c.req.param("id"));
  return row ? c.json(toAnalysisDto(row)) : c.json({ error: "Analyse niet gevonden." }, 404);
});

interface PatchBody {
  approved?: boolean;
  hidden_clue_ids?: string[];
  hidden_candidate_ids?: string[];
  clue_order?: string[];
}

// De beheerder beoordeelt een analyse vóór de presentatie: goedkeuren, onderdelen verbergen,
// volgorde van de onthulling bepalen.
analyses.patch("/:id", async (c) => {
  const row = await getAnalysis(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Analyse niet gevonden." }, 404);
  const body = (await c.req.json().catch(() => ({}))) as PatchBody;

  const result = JSON.parse(row.result_json) as Analysis;

  if (Array.isArray(body.hidden_clue_ids)) {
    const hidden = new Set(body.hidden_clue_ids);
    result.clues = result.clues.map((clue) => ({ ...clue, hidden: hidden.has(clue.id) || undefined }));
  }
  if (Array.isArray(body.hidden_candidate_ids)) {
    const hidden = new Set(body.hidden_candidate_ids);
    result.candidates = result.candidates.map((cand) => ({ ...cand, hidden: hidden.has(cand.id) || undefined }));
  }
  if (Array.isArray(body.clue_order)) {
    const position = new Map(body.clue_order.map((id, index) => [id, index]));
    result.clues = [...result.clues].sort(
      (a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  const approved = typeof body.approved === "boolean" ? (body.approved ? 1 : 0) : row.approved;
  await c.env.DB.prepare("UPDATE analyses SET result_json = ?, approved = ? WHERE id = ?")
    .bind(JSON.stringify(result), approved, row.id)
    .run();
  const updated = await getAnalysis(c.env.DB, row.id);
  return c.json(toAnalysisDto(updated as NonNullable<typeof updated>));
});

analyses.delete("/:id", async (c) => {
  const row = await getAnalysis(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Analyse niet gevonden." }, 404);
  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE analysis_id = ? OR masked_analysis_id = ?")
    .bind(row.id, row.id)
    .first<{ n: number }>();
  if ((used?.n ?? 0) > 0) return c.json({ error: "Deze analyse wordt gebruikt door een sessie." }, 409);
  await c.env.DB.prepare("DELETE FROM analyses WHERE id = ?").bind(row.id).run();
  return c.json({ ok: true });
});
