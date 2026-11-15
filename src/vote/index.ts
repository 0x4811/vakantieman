// Publieke stem-Worker. Staat bewust los van de beveiligde Worker: Cloudflare Access op een
// workers.dev-adres dekt de hele Worker, en het publiek mag hier zonder inlog stemmen.
// Deze Worker kan alleen stemmen en de status lezen; hij heeft geen toegang tot foto's, D1 of R2.

import { Hono } from "hono";
import { CODE_PATTERN } from "../worker/db";
import { PAGE_CSP, SECURITY_HEADERS, withHeaders } from "../worker/http";
import { VOTE_TOKEN_PATTERN } from "../shared/session";
import { isValidLatLon } from "../shared/geo";

interface VoteEnv {
  SESSIONS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: VoteEnv }>();

app.use("*", async (c, next) => {
  await next();
  const res = new Response(c.res.body, c.res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
  c.res = res;
});

const room = (env: VoteEnv, code: string) => env.SESSIONS.get(env.SESSIONS.idFromName(code));
const validCode = (value: string): boolean => CODE_PATTERN.test(value);

app.get("/healthz", (c) => c.text("ok"));

app.get("/", (c) => c.html("<!doctype html><meta charset=utf-8><title>vakantieman</title><p>Scan de QR-code op het scherm om mee te doen."));

// Stempagina. De code wordt gecontroleerd voordat er een sessiekamer wordt aangesproken.
app.get("/v/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!validCode(code)) return c.text("Onbekende code.", 404);
  const res = await c.env.ASSETS.fetch(new Request(new URL("/vote", c.req.url)));
  return withHeaders(res, { "content-security-policy": PAGE_CSP, "cache-control": "no-store" });
});

app.get("/assets/*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.get("/api/vote/:code/status", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!validCode(code)) return c.json({ error: "Onbekende code." }, 404);
  const res = await room(c.env, code).fetch("https://room/status");
  const status = (await res.json()) as { ready: boolean; phase: string; votes_open: boolean; ended: boolean; vote_count: number };
  if (!status.ready) return c.json({ error: "Onbekende code." }, 404);
  // Alleen wat de stempagina nodig heeft.
  return c.json(
    { open: status.votes_open, ended: status.ended, started: status.phase !== "idle", count: status.vote_count },
    200,
    { "cache-control": "no-store" }
  );
});

app.post("/api/vote/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!validCode(code)) return c.json({ error: "Onbekende code." }, 404);
  if (Number(c.req.header("content-length") ?? 0) > 512) return c.json({ error: "Aanvraag te groot." }, 413);
  const body = (await c.req.json().catch(() => null)) as { token?: unknown; lat?: unknown; lon?: unknown } | null;
  if (!body || typeof body.token !== "string" || !VOTE_TOKEN_PATTERN.test(body.token)) return c.json({ error: "Ongeldige stem." }, 400);
  if (typeof body.lat !== "number" || typeof body.lon !== "number" || !isValidLatLon(body.lat, body.lon)) {
    return c.json({ error: "Ongeldige locatie." }, 400);
  }
  const res = await room(c.env, code).fetch("https://room/vote", {
    method: "POST",
    body: JSON.stringify({ token: body.token, lat: body.lat, lon: body.lon })
  });
  const out = (await res.json()) as { ok?: boolean; error?: string };
  return c.json(out, res.status as 200 | 400 | 404 | 409 | 429);
});

app.notFound((c) => c.json({ error: "Niet gevonden." }, 404));
app.onError((error, c) => {
  console.error("Fout in stem-Worker:", error);
  return c.json({ error: "Er ging iets mis." }, 500);
});

export default { fetch: app.fetch };
