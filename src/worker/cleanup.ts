// Opschonen: verlopen sessies afsluiten (stemmen worden dan gewist) en "alles wissen".

import type { Env } from "./env";
import type { SessionRow } from "./db";
import { isStale } from "../shared/stale";

const room = (env: Env, code: string) => env.SESSIONS.get(env.SESSIONS.idFromName(code));

export async function endStaleSessions(env: Env, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM sessions WHERE state != 'ended'").all<SessionRow>();
  let ended = 0;
  for (const s of results) {
    if (!isStale(s, now)) continue;
    try {
      await room(env, s.code).fetch("https://room/end", { method: "POST" });
    } catch (error) {
      console.error("Sessie afsluiten mislukt:", s.code, error);
    }
    await env.DB.prepare("UPDATE sessions SET state = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?")
      .bind(new Date(now).toISOString(), s.id)
      .run();
    ended++;
  }
  return ended;
}

/** Verwijdert alle sessies, stemmen, analyses, foto's (D1 én R2). Onomkeerbaar. */
export async function wipeEverything(env: Env): Promise<{ sessions: number; photos: number; objects: number }> {
  const sessions = await env.DB.prepare("SELECT code FROM sessions").all<{ code: string }>();
  for (const s of sessions.results) {
    try {
      await room(env, s.code).fetch("https://room/wipe", { method: "POST" });
    } catch (error) {
      console.error("Sessiekamer wissen mislukt:", s.code, error);
    }
  }
  let objects = 0;
  let cursor: string | undefined;
  do {
    const list = await env.PHOTOS.list({ prefix: "photos/", cursor, limit: 500 });
    const keys = list.objects.map((o) => o.key);
    if (keys.length) await env.PHOTOS.delete(keys);
    objects += keys.length;
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  const photos = await env.DB.prepare("SELECT COUNT(*) AS n FROM photos").first<{ n: number }>();
  await env.DB.batch([env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM analyses"), env.DB.prepare("DELETE FROM photos")]);
  return { sessions: sessions.results.length, photos: photos?.n ?? 0, objects };
}
