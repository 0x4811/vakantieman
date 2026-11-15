// Foto's: uploaden (zonder metadata), ophalen, bijwerken, verwijderen en analyseren.

import { Hono } from "hono";
import { AnalysisParseError } from "../../shared/analysis";
import { isValidLatLon } from "../../shared/geo";
import { applyRevealLevel } from "../../shared/levels";
import { REVEAL_LEVELS, SENSITIVITIES, type Analysis, type RevealLevel, type Sensitivity, type Variant } from "../../shared/types";
import {
  getPhoto,
  nowIso,
  toAnalysisDto,
  toPhotoDto,
  type AnalysisRow,
  type PhotoRow
} from "../db";
import { MAX_BASE64_CHARS, MAX_PHOTO_BYTES, type AppContext, type Env } from "../env";
import { clean } from "../http";
import { inspectJpeg } from "../jpeg";
import { assertProvider, createProvider, isProviderAllowed, ProviderError } from "../vision";
import type { AiBinding } from "../vision/types";

export const photos = new Hono<AppContext>();

const BASE64_START = /^[A-Za-z0-9+/]{100}/;

const isLevel = (v: unknown): v is RevealLevel => (REVEAL_LEVELS as readonly string[]).includes(String(v));
const isSensitivity = (v: unknown): v is Sensitivity => (SENSITIVITIES as readonly string[]).includes(String(v));

async function readJpeg(c: { req: { header(n: string): string | undefined; arrayBuffer(): Promise<ArrayBuffer> } }) {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_PHOTO_BYTES) return { error: "De foto is te groot (maximaal 8 MB).", status: 413 as const };
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > MAX_PHOTO_BYTES) return { error: "De foto is te groot (maximaal 8 MB).", status: 413 as const };
  const check = inspectJpeg(bytes);
  if (!check.ok) return { error: check.reason, status: 422 as const };
  return { bytes, width: check.width, height: check.height };
}

photos.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM photos ORDER BY created_at DESC").all<PhotoRow>();
  return c.json(results.map(toPhotoDto));
});

// Upload: ruwe JPEG-bytes in de body, gegevens in de querystring.
photos.post("/", async (c) => {
  const q = c.req.query();
  const label = clean(q.label, 80);
  const place = clean(q.place, 120);
  const lat = Number(q.lat);
  const lon = Number(q.lon);
  if (!label) return c.json({ error: "Geef de foto een naam." }, 400);
  if (!place) return c.json({ error: "Geef de plaatsnaam zoals het publiek die mag zien." }, 400);
  if (!isValidLatLon(lat, lon)) return c.json({ error: "Ongeldige coördinaten." }, 400);
  if (!isLevel(q.level)) return c.json({ error: "Ongeldig detailniveau." }, 400);
  if (!isSensitivity(q.sensitivity)) return c.json({ error: "Ongeldige gevoeligheid." }, 400);

  const jpeg = await readJpeg(c);
  if ("error" in jpeg) return c.json({ error: jpeg.error }, jpeg.status);

  const id = crypto.randomUUID();
  const key = `photos/${id}/original.jpg`;
  await c.env.PHOTOS.put(key, jpeg.bytes, { httpMetadata: { contentType: "image/jpeg" } });

  const row: PhotoRow = {
    id,
    label,
    r2_key: key,
    masked_r2_key: null,
    true_lat: lat,
    true_lon: lon,
    true_place: place,
    reveal_level: q.level,
    sensitivity: q.sensitivity,
    width: jpeg.width,
    height: jpeg.height,
    created_at: nowIso()
  };
  try {
    await c.env.DB.prepare(
      `INSERT INTO photos (id, label, r2_key, masked_r2_key, true_lat, true_lon, true_place, reveal_level, sensitivity, width, height, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(row.id, row.label, row.r2_key, row.true_lat, row.true_lon, row.true_place, row.reveal_level, row.sensitivity, row.width, row.height, row.created_at)
      .run();
  } catch (error) {
    await c.env.PHOTOS.delete(key);
    throw error;
  }
  return c.json(toPhotoDto(row), 201);
});

photos.get("/:id", async (c) => {
  const row = await getPhoto(c.env.DB, c.req.param("id"));
  return row ? c.json(toPhotoDto(row)) : c.json({ error: "Foto niet gevonden." }, 404);
});

// Gegevens bijwerken. Een grover detailniveau wordt meteen op bestaande analyses toegepast;
// een fijner niveau kan niet terugwerken (de details zijn al weggehaald).
photos.patch("/:id", async (c) => {
  const row = await getPhoto(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Foto niet gevonden." }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const label = body.label === undefined ? row.label : clean(body.label, 80);
  const place = body.true_place === undefined ? row.true_place : clean(body.true_place, 120);
  const lat = body.true_lat === undefined ? row.true_lat : Number(body.true_lat);
  const lon = body.true_lon === undefined ? row.true_lon : Number(body.true_lon);
  const level = body.reveal_level === undefined ? row.reveal_level : body.reveal_level;
  const sensitivity = body.sensitivity === undefined ? row.sensitivity : body.sensitivity;
  if (!label || !place) return c.json({ error: "Naam en plaatsnaam mogen niet leeg zijn." }, 400);
  if (!isValidLatLon(lat, lon)) return c.json({ error: "Ongeldige coördinaten." }, 400);
  if (!isLevel(level)) return c.json({ error: "Ongeldig detailniveau." }, 400);
  if (!isSensitivity(sensitivity)) return c.json({ error: "Ongeldige gevoeligheid." }, 400);

  await c.env.DB.prepare(
    "UPDATE photos SET label = ?, true_place = ?, true_lat = ?, true_lon = ?, reveal_level = ?, sensitivity = ? WHERE id = ?"
  )
    .bind(label, place, lat, lon, level, sensitivity, row.id)
    .run();

  if (level !== row.reveal_level) {
    const { results } = await c.env.DB.prepare("SELECT * FROM analyses WHERE photo_id = ?").bind(row.id).all<AnalysisRow>();
    for (const a of results) {
      const narrowed = applyRevealLevel(JSON.parse(a.result_json) as Analysis, level);
      await c.env.DB.prepare("UPDATE analyses SET result_json = ? WHERE id = ?").bind(JSON.stringify(narrowed), a.id).run();
    }
  }
  const updated = await getPhoto(c.env.DB, row.id);
  return c.json(toPhotoDto(updated as PhotoRow));
});

photos.delete("/:id", async (c) => {
  const row = await getPhoto(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Foto niet gevonden." }, 404);

  // Live-toestand van sessies bij deze foto ook opruimen.
  const { results: sessions } = await c.env.DB.prepare("SELECT code FROM sessions WHERE photo_id = ?")
    .bind(row.id)
    .all<{ code: string }>();
  for (const s of sessions) {
    await c.env.SESSIONS.get(c.env.SESSIONS.idFromName(s.code)).fetch("https://room/wipe", { method: "POST" });
  }

  await c.env.PHOTOS.delete([row.r2_key, ...(row.masked_r2_key ? [row.masked_r2_key] : [])]);
  await c.env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(row.id).run();
  return c.json({ ok: true });
});

photos.get("/:id/image", async (c) => {
  const row = await getPhoto(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Foto niet gevonden." }, 404);
  const variant = c.req.query("variant") === "masked" ? "masked" : "original";
  const key = variant === "masked" ? row.masked_r2_key : row.r2_key;
  if (!key) return c.json({ error: "Deze variant bestaat niet." }, 404);
  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.json({ error: "Beeldbestand ontbreekt." }, 404);
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300", etag: object.httpEtag }
  });
});

// Bewerkte foto (lekkende details afgedekt): zelfde afmetingen als het origineel.
photos.put("/:id/masked", async (c) => {
  const row = await getPhoto(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Foto niet gevonden." }, 404);
  const jpeg = await readJpeg(c);
  if ("error" in jpeg) return c.json({ error: jpeg.error }, jpeg.status);
  if (jpeg.width !== row.width || jpeg.height !== row.height) {
    return c.json({ error: "De bewerkte foto moet dezelfde afmetingen hebben als het origineel." }, 422);
  }
  const key = `photos/${row.id}/masked.jpg`;
  await c.env.PHOTOS.put(key, jpeg.bytes, { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare("UPDATE photos SET masked_r2_key = ? WHERE id = ?").bind(key, row.id).run();
  return c.json(toPhotoDto({ ...row, masked_r2_key: key }));
});

function providerConfig(env: Env) {
  return {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    AI: env.AI as unknown as AiBinding | undefined
  };
}

// Analyse starten. De browser levert de afbeelding als base64 in de body, zodat de Worker
// niets hoeft te coderen (CPU-limiet van het gratis plan).
photos.post("/:id/analyze", async (c) => {
  const row = await getPhoto(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "Foto niet gevonden." }, 404);

  const q = c.req.query();
  let providerId;
  try {
    providerId = assertProvider(q.provider || c.env.VISION_PROVIDER || "mock");
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  const variant: Variant = q.variant === "masked" ? "masked" : "original";
  if (variant === "masked" && !row.masked_r2_key) {
    return c.json({ error: "Upload eerst de bewerkte foto." }, 409);
  }

  const policy = isProviderAllowed(providerId, row.sensitivity, c.env);
  if (!policy.allowed) return c.json({ error: policy.reason }, 403);

  const imageBase64 = (await c.req.text()).trim();
  if (imageBase64.length > MAX_BASE64_CHARS) return c.json({ error: "De afbeelding is te groot." }, 413);
  if (!BASE64_START.test(imageBase64)) return c.json({ error: "De body moet de afbeelding als base64 bevatten." }, 400);

  const model = q.model || (providerId === c.env.VISION_PROVIDER ? c.env.VISION_MODEL : "") || undefined;

  let result;
  try {
    result = await createProvider(providerId, providerConfig(c.env)).analyze({
      imageBase64,
      mime: "image/jpeg",
      width: row.width,
      height: row.height,
      revealLevel: row.reveal_level,
      variant,
      model
    });
  } catch (error) {
    if (error instanceof ProviderError) return c.json({ error: error.message }, error.status as 400);
    if (error instanceof AnalysisParseError) return c.json({ error: error.message }, 502);
    throw error;
  }

  // Het ruwe modelantwoord wordt nooit opgeslagen: eerst beperken tot het detailniveau.
  const limited = applyRevealLevel(result.analysis, row.reveal_level);
  const analysisRow: AnalysisRow = {
    id: crypto.randomUUID(),
    photo_id: row.id,
    variant,
    provider: result.provider,
    model: result.model,
    result_json: JSON.stringify(limited),
    approved: 0,
    latency_ms: result.latencyMs,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    created_at: nowIso()
  };
  await c.env.DB.prepare(
    `INSERT INTO analyses (id, photo_id, variant, provider, model, result_json, approved, latency_ms, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  )
    .bind(
      analysisRow.id,
      analysisRow.photo_id,
      analysisRow.variant,
      analysisRow.provider,
      analysisRow.model,
      analysisRow.result_json,
      analysisRow.latency_ms,
      analysisRow.input_tokens,
      analysisRow.output_tokens,
      analysisRow.created_at
    )
    .run();

  return c.json(toAnalysisDto(analysisRow), 201);
});

photos.get("/:id/analyses", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM analyses WHERE photo_id = ? ORDER BY created_at DESC")
    .bind(c.req.param("id"))
    .all<AnalysisRow>();
  return c.json(results.map(toAnalysisDto));
});
