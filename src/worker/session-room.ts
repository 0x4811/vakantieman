// Sessiekamer: één Durable Object per sessiecode.
// Bewaart het script, de toestand en de stemmen; verbindt presentatie- en bedienscherm via
// hibernatable WebSockets. Stemmen komen binnen via HTTP (vanuit de publieke Worker).

import { DurableObject } from "cloudflare:workers";
import {
  computeResults,
  initialState,
  isAction,
  MAX_VOTE_CHANGES,
  MAX_VOTES,
  reduce,
  scriptCounts,
  topCandidate,
  VOTE_TOKEN_PATTERN,
  type ClientCounts,
  type RevealResults,
  type ServerMessage,
  type SessionScript,
  type SessionState
} from "../shared/session";
import { isValidLatLon } from "../shared/geo";
import type { SessionSummary } from "../shared/types";
import type { Env } from "./env";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

type Role = "present" | "control";

export class SessionRoom extends DurableObject<Env> {
  private script: SessionScript | null = null;
  private state: SessionState = initialState();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS votes (
           token TEXT PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, changes INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL
         )`
      );
      this.script = (await ctx.storage.get<SessionScript>("script")) ?? null;
      this.state = (await ctx.storage.get<SessionState>("state")) ?? initialState();
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ------------------------------------------------------------ helpers

  private votes(): [number, number][] {
    return this.ctx.storage.sql
      .exec<{ lat: number; lon: number }>("SELECT lat, lon FROM votes ORDER BY at LIMIT ?", MAX_VOTES)
      .toArray()
      .map((r) => [r.lon, r.lat]);
  }

  private voteCount(): number {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM votes").one().n;
  }

  private clients(): ClientCounts {
    const counts: ClientCounts = { present: 0, control: 0 };
    for (const ws of this.ctx.getWebSockets()) {
      const role = (this.ctx.getTags(ws)[0] ?? "present") as Role;
      counts[role]++;
    }
    return counts;
  }

  private results(): RevealResults | null {
    const script = this.script;
    if (!script) return null;
    const visible = this.state.phase === "reveal" || this.state.phase === "lesson" || this.state.phase === "masked" || this.state.phase === "done";
    if (!visible) return null;
    const pts = this.ctx.storage.sql
      .exec<{ lat: number; lon: number }>("SELECT lat, lon FROM votes LIMIT ?", MAX_VOTES)
      .toArray();
    return computeResults(pts, script.photo.truth, topCandidate(script.analysis), topCandidate(script.masked));
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      /* verbinding is al weg */
    }
  }

  private broadcast(message: ServerMessage): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* verbinding is al weg */
      }
    }
  }

  private async saveState(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  private snapshot(): ServerMessage | null {
    if (!this.script) return null;
    return {
      t: "snapshot",
      script: this.script,
      state: this.state,
      votes: this.votes(),
      vote_count: this.voteCount(),
      results: this.results(),
      clients: this.clients()
    };
  }

  // ------------------------------------------------------------ HTTP

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/init" && request.method === "POST") {
      const body = (await request.json()) as { script: SessionScript; keepVotes?: boolean };
      this.script = body.script;
      await this.ctx.storage.put("script", body.script);
      if (!body.keepVotes) {
        this.ctx.storage.sql.exec("DELETE FROM votes");
        this.state = initialState();
        await this.saveState();
      }
      const snap = this.snapshot();
      if (snap) this.broadcast(snap);
      return json({ ok: true });
    }

    if (path === "/status") {
      return json({
        ready: this.script !== null,
        phase: this.state.phase,
        votes_open: this.state.votesOpen && !this.state.ended,
        ended: this.state.ended,
        vote_count: this.voteCount(),
        clients: this.clients()
      });
    }

    if (path === "/info") {
      return json({ ready: this.script !== null, phase: this.state.phase, ended: this.state.ended });
    }

    if (path === "/vote" && request.method === "POST") {
      if (!this.script) return json({ error: "Deze sessie bestaat niet." }, 404);
      if (!this.state.votesOpen || this.state.ended) return json({ error: "De raadronde is niet open." }, 409);
      const body = (await request.json().catch(() => null)) as { token?: string; lat?: number; lon?: number } | null;
      if (!body || typeof body.token !== "string" || !VOTE_TOKEN_PATTERN.test(body.token)) return json({ error: "Ongeldige stem." }, 400);
      const { lat, lon } = body;
      if (typeof lat !== "number" || typeof lon !== "number" || !isValidLatLon(lat, lon)) return json({ error: "Ongeldige locatie." }, 400);

      const sql = this.ctx.storage.sql;
      const existing = sql.exec<{ changes: number }>("SELECT changes FROM votes WHERE token = ?", body.token).toArray()[0];
      if (existing) {
        if (existing.changes >= MAX_VOTE_CHANGES) return json({ error: "Je hebt je gok te vaak aangepast." }, 429);
        sql.exec("UPDATE votes SET lat = ?, lon = ?, changes = changes + 1, at = ? WHERE token = ?", lat, lon, Date.now(), body.token);
      } else {
        if (this.voteCount() >= MAX_VOTES) return json({ error: "De raadronde zit vol." }, 429);
        sql.exec("INSERT INTO votes (token, lat, lon, changes, at) VALUES (?, ?, ?, 0, ?)", body.token, lat, lon, Date.now());
      }
      // Meldingen worden gebundeld, zodat honderden gelijktijdige stemmen niet honderden berichten geven.
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 700);
      return json({ ok: true });
    }

    if (path === "/ws") {
      if (request.headers.get("upgrade") !== "websocket") return new Response("WebSocket vereist.", { status: 426 });
      if (!this.script) return json({ error: "Deze sessie bestaat niet." }, 404);
      const role: Role = url.searchParams.get("role") === "control" ? "control" : "present";
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [role]);
      const snap = this.snapshot();
      if (snap) this.send(pair[1], snap);
      this.broadcast({ t: "clients", clients: this.clients() });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (path === "/end" && request.method === "POST") {
      const summary = await this.finish();
      return json({ ok: true, summary });
    }

    if (path === "/wipe" && request.method === "POST") {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1001, "Sessie verwijderd");
        } catch {
          /* al gesloten */
        }
      }
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.script = null;
      this.state = initialState();
      return json({ ok: true });
    }

    return json({ error: "Niet gevonden." }, 404);
  }

  // ------------------------------------------------------------ WebSocket

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 2000) return;
    // Bedienscherm en presentatie (toetsenbordklikker) mogen allebei bedienen; beide zitten achter Access.
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null || (message as { t?: unknown }).t !== "action") return;
    const action = (message as { action?: unknown }).action;
    if (!isAction(action) || !this.script) {
      this.send(ws, { t: "error", message: "Ongeldige actie." });
      return;
    }
    const wasEnded = this.state.ended;
    this.state = reduce(this.state, action, scriptCounts(this.script));
    await this.saveState();
    if (this.state.ended && !wasEnded) {
      await this.finish();
      return;
    }
    if (this.state.phase !== "idle") {
      await this.env.DB.prepare("UPDATE sessions SET state = 'live', started_at = ? WHERE code = ? AND state = 'created'")
        .bind(new Date().toISOString(), this.script.code)
        .run()
        .catch(() => undefined);
    }
    if (action.type === "reset") this.ctx.storage.sql.exec("DELETE FROM votes");
    this.broadcast({ t: "state", state: this.state, results: this.results() });
    if (action.type === "reset") this.broadcast({ t: "votes", points: [], count: 0 });
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "Gesloten");
    } catch {
      /* al gesloten */
    }
    this.broadcast({ t: "clients", clients: this.clients() });
  }

  async webSocketError(): Promise<void> {
    this.broadcast({ t: "clients", clients: this.clients() });
  }

  // ------------------------------------------------------------ alarm: gebundelde stemmeldingen

  async alarm(): Promise<void> {
    this.broadcast({ t: "votes", points: this.votes(), count: this.voteCount() });
  }

  // ------------------------------------------------------------ afsluiten

  /** Sluit de sessie af: samenvatting naar D1, stemmen worden gewist. */
  private async finish(): Promise<SessionSummary | null> {
    const script = this.script;
    if (!script) return null;
    this.state = { ...reduce(this.state, { type: "end" }, scriptCounts(script)) };
    await this.saveState();
    const pts = this.ctx.storage.sql.exec<{ lat: number; lon: number }>("SELECT lat, lon FROM votes").toArray();
    const r = computeResults(pts, script.photo.truth, topCandidate(script.analysis), topCandidate(script.masked));
    const summary: SessionSummary = {
      votes: r.votes,
      median_km: r.median_km,
      closest_km: r.closest_km,
      tool_km: r.tool_km,
      masked_tool_km: r.masked_tool_km,
      ended_at: new Date().toISOString()
    };
    try {
      await this.env.DB.prepare("UPDATE sessions SET state = 'ended', ended_at = ?, summary_json = ? WHERE code = ?")
        .bind(summary.ended_at, JSON.stringify(summary), script.code)
        .run();
    } catch (error) {
      console.error("Samenvatting opslaan mislukt:", error);
    }
    // Individuele stemmen zijn alleen voor de live demo bedoeld en worden direct gewist.
    this.broadcast({ t: "state", state: this.state, results: r });
    this.ctx.storage.sql.exec("DELETE FROM votes");
    return summary;
  }
}
