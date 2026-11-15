// Tijdelijke stub; de echte sessiekamer komt in fase 2.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export class SessionRoom extends DurableObject<Env> {
  async fetch(_request: Request): Promise<Response> {
    return new Response(JSON.stringify({ error: "Nog niet beschikbaar." }), {
      status: 501,
      headers: { "content-type": "application/json" }
    });
  }
}
