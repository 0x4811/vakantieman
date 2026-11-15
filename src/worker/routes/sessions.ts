// Sessies: een foto plus goedgekeurde analyse(s), met een korte code en een eigen sessiekamer.

import { Hono } from "hono";
import { CODE_PATTERN, generateCode, getAnalysis, getPhoto, getSession, getSessionByCode, nowIso, toSessionDto, type SessionRow } from "../db";
import type { AppContext, Env } from "../env";
import { buildScript } from "../script";

export const sessions = new Hono<AppContext>();

const room = (env: Env, code: string) => env.SESSIONS.get(env.SESSIONS.idFromName(code));

async function pushScript(env: Env, row: SessionRow, keepVotes: boolean): Promise<string | null> {
  const built = await buildScript(env, row);
  if (!built.ok) return built.error;
  await room(env, row.code).fetch("https://room/init", {
    method: "POST",
    body: JSON.stringify({ script: built.script, keepVotes })
  });
  return null;
}

sessions.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT 100").all<SessionRow>();
  return c.json(results.map(toSessionDto));
});

sessions.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { photo_id?: string; analysis_id?: string; masked_analysis_id?: string | null };
  if (!body.photo_id || !body.analysis_id) return c.json({ error: "Kies een foto en een analyse." }, 400);

  const photo = await getPhoto(c.env.DB, body.photo_id);
  if (!photo) return c.json({ error: "Foto niet gevonden." }, 404);
  const analysis = await getAnalysis(c.env.DB, body.analysis_id);
  if (!analysis || analysis.photo_id !== photo.id || analysis.variant !== "original") {
    return c.json({ error: "Deze analyse hoort niet bij de foto." }, 400);
  }
  if (analysis.approved !== 1) return c.json({ error: "Keur de analyse eerst goed." }, 409);

  let maskedId: string | null = null;
  if (body.masked_analysis_id) {
    const masked = await getAnalysis(c.env.DB, body.masked_analysis_id);
    if (!masked || masked.photo_id !== photo.id || masked.variant !== "masked") {
      return c.json({ error: "Deze analyse van de bewerkte foto hoort niet bij de foto." }, 400);
    }
    if (masked.approved !== 1) return c.json({ error: "Keur de analyse van de bewerkte foto eerst goed." }, 409);
    maskedId = masked.id;
  }

  const id = crypto.randomUUID();
  let code = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateCode();
    if (!(await getSessionByCode(c.env.DB, candidate))) {
      code = candidate;
      break;
    }
  }
  if (!code) return c.json({ error: "Er kon geen vrije code worden gemaakt." }, 500);

  await c.env.DB.prepare(
    "INSERT INTO sessions (id, code, photo_id, analysis_id, masked_analysis_id, state, created_at) VALUES (?, ?, ?, ?, ?, 'created', ?)"
  )
    .bind(id, code, photo.id, analysis.id, maskedId, nowIso())
    .run();

  const row = (await getSession(c.env.DB, id)) as SessionRow;
  const error = await pushScript(c.env, row, false);
  if (error) return c.json({ error }, 500);
  return c.json(toSessionDto(row), 201);
});

sessions.get("/:id", async (c) => {
  const row = await getSession(c.env.DB, c.req.param("id"));
  return row ? c.json(toSessionDto(row)) : c.json({ error: "Sessie niet gevonden." }, 404);
});

// Script opnieuw opbouwen (bijvoorbeeld na het aanpassen van een analyse). Tijdens een live sessie alleen met ?force=1.
sessions.post("/:id/refresh", async (c) => {
  const row = await getSession(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Sessie niet gevonden." }, 404);
  if (row.state === "ended") return c.json({ error: "Deze sessie is afgesloten." }, 409);
  if (row.state === "live" && c.req.query("force") !== "1") {
    return c.json({ error: "Deze sessie is live. Vernieuwen verstoort de presentatie." }, 409);
  }
  const error = await pushScript(c.env, row, row.state === "live");
  return error ? c.json({ error }, 500) : c.json({ ok: true });
});

sessions.delete("/:id", async (c) => {
  const row = await getSession(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Sessie niet gevonden." }, 404);
  await room(c.env, row.code).fetch("https://room/wipe", { method: "POST" });
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(row.id).run();
  return c.json({ ok: true });
});

/** Gedeeld met de WebSocket-route in index.ts. */
export async function connectSocket(env: Env, code: string, request: Request, role: string): Promise<Response> {
  if (!CODE_PATTERN.test(code)) return new Response("Ongeldige code.", { status: 400 });
  return room(env, code).fetch(`https://room/ws?role=${role === "control" ? "control" : "present"}`, request);
}
