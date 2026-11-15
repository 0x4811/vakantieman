// End-to-end-test tegen een draaiende `wrangler dev` (standaard http://localhost:8787).
// Gebruik: npm run e2e   (start eerst: npm run dev)

import assert from "node:assert/strict";
import { request } from "node:http";
import { makeJpeg } from "../tests/helpers";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const VOTE = process.env.VOTE_URL ?? "http://localhost:8788";
const H = { "x-requested-with": "vakantieman" };

let passed = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FOUT ${name}\n       ${(error as Error).message}`);
    process.exitCode = 1;
    throw error;
  }
}

async function api<T = any>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<{ status: number; body: T }> {
  const method = init.method ?? "GET";
  const headers = { ...(method === "GET" ? {} : H), ...(init.headers ?? {}) };
  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // geen JSON
  }
  return { status: res.status, body };
}


async function vote(code: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${VOTE}/api/vote/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const jpegBytes = makeJpeg({ width: 1200, height: 800 });
const IMAGE_B64 = b64(new Uint8Array(900).fill(7)); // lang genoeg voor de base64-controle (geen echt beeld nodig voor de mock)

async function main(): Promise<void> {
  console.log(`E2E tegen ${BASE}`);

  await step("healthz is open", async () => {
    const r = await fetch(BASE + "/healthz");
    assert.equal(r.status, 200);
  });

  await step("config toont providers en de mock is beschikbaar", async () => {
    const r = await api("/api/config");
    assert.equal(r.status, 200);
    assert.equal(r.body.default_provider, "mock");
    assert.ok(r.body.providers.find((p: any) => p.id === "mock" && p.available));
    assert.equal(r.body.providers.find((p: any) => p.id === "claude").available, false);
  });

  await step("wijzigende aanvragen zonder CSRF-header worden geweigerd", async () => {
    const res = await fetch(BASE + "/api/photos", { method: "POST", body: jpegBytes });
    assert.equal(res.status, 403);
  });

  let photoId = "";
  await step("upload met EXIF wordt geweigerd", async () => {
    const dirty = makeJpeg({ exif: true });
    const r = await api("/api/photos?label=x&place=Antwerpen&lat=51.2&lon=4.4&level=city&sensitivity=public", { method: "POST", body: dirty });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /metadata/i);
  });

  await step("upload met ongeldige gegevens wordt geweigerd", async () => {
    assert.equal((await api("/api/photos?label=&place=A&lat=51&lon=4&level=city&sensitivity=public", { method: "POST", body: jpegBytes })).status, 400);
    assert.equal((await api("/api/photos?label=x&place=A&lat=999&lon=4&level=city&sensitivity=public", { method: "POST", body: jpegBytes })).status, 400);
    assert.equal((await api("/api/photos?label=x&place=A&lat=51&lon=4&level=huis&sensitivity=public", { method: "POST", body: jpegBytes })).status, 400);
  });

  await step("schone upload slaagt", async () => {
    const r = await api("/api/photos?label=Testselfie&place=Antwerpen,%20Belgi%C3%AB&lat=51.21254&lon=4.39521&level=city&sensitivity=private", {
      method: "POST",
      body: jpegBytes
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.width, 1200);
    assert.equal(r.body.height, 800);
    assert.equal(r.body.reveal_level, "city");
    photoId = r.body.id;
  });

  await step("foto staat in de lijst en het beeld is op te halen", async () => {
    const list = await api("/api/photos");
    assert.ok(list.body.some((p: any) => p.id === photoId));
    const img = await fetch(`${BASE}/api/photos/${photoId}/image`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    assert.equal((await img.arrayBuffer()).byteLength, jpegBytes.length);
  });

  let analysisId = "";
  let maskedAnalysisId = "";
  await step("analyse met mock wordt beperkt tot stadsniveau", async () => {
    const r = await api(`/api/photos/${photoId}/analyze?provider=mock`, { method: "POST", body: IMAGE_B64, headers: { "content-type": "text/plain" } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    analysisId = r.body.id;
    const cand = r.body.result.candidates[0];
    assert.equal(cand.city, "Antwerpen");
    assert.equal(cand.district, "");
    assert.equal(cand.street, "");
    assert.equal(cand.lat, 51.2); // afgerond op 0,1 graad
    assert.ok(cand.radius_km >= 10);
    const all = JSON.stringify(r.body.result);
    assert.ok(!/Leopold/i.test(all), "straatnaam lekt in de opgeslagen analyse");
    assert.equal(r.body.approved, false);
    assert.equal(r.body.provider, "mock");
  });

  await step("privéfoto mag niet naar gemini, en claude zonder sleutel geeft 503", async () => {
    const g = await api(`/api/photos/${photoId}/analyze?provider=gemini`, { method: "POST", body: IMAGE_B64 });
    assert.equal(g.status, 403);
    const c = await api(`/api/photos/${photoId}/analyze?provider=claude`, { method: "POST", body: IMAGE_B64 });
    assert.equal(c.status, 503);
    assert.match(c.body.error, /ANTHROPIC_API_KEY/);
  });

  await step("analyse zonder base64-body wordt geweigerd", async () => {
    const r = await api(`/api/photos/${photoId}/analyze?provider=mock`, { method: "POST", body: "kort" });
    assert.equal(r.status, 400);
  });

  await step("goedkeuren en onderdelen verbergen", async () => {
    const r = await api(`/api/analyses/${analysisId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true, hidden_clue_ids: ["c5"], clue_order: ["c4", "c3", "c2", "c1", "c5"] })
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.approved, true);
    assert.equal(r.body.result.clues[0].id, "c4");
    assert.equal(r.body.result.clues.find((c: any) => c.id === "c5").hidden, true);
  });

  await step("grover detailniveau werkt terug op bestaande analyses", async () => {
    const p = await api(`/api/photos/${photoId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reveal_level: "country" }) });
    assert.equal(p.status, 200);
    const a = await api(`/api/analyses/${analysisId}`);
    assert.equal(a.body.result.candidates[0].city, "");
    assert.equal(a.body.result.candidates[0].lat, 51);
    assert.ok(!/Antwerpen/i.test(JSON.stringify(a.body.result)), "stadsnaam staat nog in de analyse");
  });

  await step("bewerkte foto: andere afmetingen worden geweigerd, juiste afmetingen slagen", async () => {
    const wrong = await api(`/api/photos/${photoId}/masked`, { method: "PUT", body: makeJpeg({ width: 10, height: 10 }) });
    assert.equal(wrong.status, 422);
    const ok = await api(`/api/photos/${photoId}/masked`, { method: "PUT", body: makeJpeg({ width: 1200, height: 800 }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.has_masked, true);
    const img = await fetch(`${BASE}/api/photos/${photoId}/image?variant=masked`);
    assert.equal(img.status, 200);
  });

  await step("analyse van de bewerkte variant geeft een onzekere uitkomst", async () => {
    const r = await api(`/api/photos/${photoId}/analyze?provider=mock&variant=masked`, { method: "POST", body: IMAGE_B64 });
    assert.equal(r.status, 201);
    assert.equal(r.body.variant, "masked");
    assert.ok(r.body.result.overall_confidence < 0.3);
    maskedAnalysisId = r.body.id;
  });

  // ---- sessies en live-kamer
  let sessionId = "";
  let code = "";

  await step("sessie met niet-goedgekeurde analyse wordt geweigerd", async () => {
    const fresh = await api(`/api/photos/${photoId}/analyze?provider=mock`, { method: "POST", body: IMAGE_B64 });
    const r = await api("/api/sessions", { method: "POST", body: JSON.stringify({ photo_id: photoId, analysis_id: fresh.body.id }) });
    assert.equal(r.status, 409);
    await api(`/api/analyses/${fresh.body.id}`, { method: "DELETE" });
  });

  await step("sessie aanmaken met goedgekeurde analyses", async () => {
    await api(`/api/analyses/${maskedAnalysisId}`, { method: "PATCH", body: JSON.stringify({ approved: true }) });
    const r = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ photo_id: photoId, analysis_id: analysisId, masked_analysis_id: maskedAnalysisId })
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.code, /^[A-HJKMNP-Z2-9]{5}$/);
    sessionId = r.body.id;
    code = r.body.code;
  });

  await step("websocket zonder juiste herkomst wordt geweigerd", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${BASE}/ws/${code}`, {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          origin: "https://evil.example",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ=="
        }
      });
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("upgrade", () => resolve(101));
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  });

  await step("websocket: snapshot bevat script zonder verborgen aanwijzing en zonder exacte coördinaten", async () => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws/${code}?role=control`);
    const first = await new Promise<any>((resolve, reject) => {
      ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
      ws.onerror = () => reject(new Error("socket fout"));
      setTimeout(() => reject(new Error("time-out")), 5000);
    });
    assert.equal(first.t, "snapshot");
    assert.equal(first.state.phase, "idle");
    assert.ok(!first.script.analysis.clues.some((c: any) => c.id === "c5"), "verborgen aanwijzing zit in script");
    assert.ok(first.script.masked, "masked ontbreekt");
    assert.equal(first.script.analysis.clues[0].id, "c4", "volgorde niet toegepast");
    ws.close();
  });

  await step("stem-Worker: stemmen zijn dicht voor de start, onbekende codes geven 404", async () => {
    const early = await vote(code, { token: "abcdefghijklmnop1", lat: 51, lon: 4 });
    assert.equal(early.status, 409);
    assert.equal((await fetch(`${VOTE}/api/vote/ZZZZZ/status`)).status, 404);
    assert.equal((await fetch(`${VOTE}/api/vote/abc/status`)).status, 404);
    const status: any = await (await fetch(`${VOTE}/api/vote/${code}/status`)).json();
    assert.deepEqual(Object.keys(status).sort(), ["count", "ended", "open", "started"]);
    assert.equal(status.open, false);
  });

  await step("bediening: Volgende opent de raadronde en ongeldige acties worden geweigerd", async () => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws/${code}?role=control`);
    const messages: any[] = [];
    ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
    await new Promise((r) => (ws.onopen = r));
    const until = async (pred: () => boolean) => {
      for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(pred(), "verwacht bericht kwam niet");
    };
    await until(() => messages.length >= 1);
    ws.send(JSON.stringify({ t: "action", action: { type: "next" } }));
    await until(() => messages.some((m) => m.t === "state" && m.state.phase === "guessing" && m.state.votesOpen));
    ws.send(JSON.stringify({ t: "action", action: { type: "bogus" } }));
    await until(() => messages.some((m) => m.t === "error"));
    ws.close();
  });

  await step("stem-Worker: geldige stem, ongeldige invoer, wijzigen en limiet", async () => {
    const t = "tokentokentoken01";
    assert.equal((await vote(code, { token: t, lat: 51.2, lon: 4.4 })).status, 200);
    assert.equal((await vote(code, { token: "kort", lat: 51, lon: 4 })).status, 400);
    assert.equal((await vote(code, { token: "tokentokentoken02", lat: 95, lon: 4 })).status, 400);
    assert.equal((await vote(code, { token: "tokentokentoken02", lat: "51", lon: 4 })).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await vote(code, { token: t, lat: 52 + i / 10, lon: 5 })).status, 200);
    assert.equal((await vote(code, { token: t, lat: 40, lon: 5 })).status, 429);
    const status: any = await (await fetch(`${VOTE}/api/vote/${code}/status`)).json();
    assert.equal(status.open, true);
    assert.equal(status.count, 1, "een token telt één keer");
  });

  await step("stemmen komen gebundeld bij het scherm binnen en worden niet gelekt in de status", async () => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws/${code}?role=present`);
    const messages: any[] = [];
    ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
    await new Promise((r) => (ws.onopen = r));
    for (let i = 0; i < 20; i++) await vote(code, { token: `bulkbulkbulk${String(i).padStart(4, "0")}`, lat: 48 + i / 10, lon: 2 });
    for (let i = 0; i < 60 && !messages.some((m) => m.t === "votes" && m.count === 21); i++) await new Promise((r) => setTimeout(r, 100));
    const votes = messages.filter((m) => m.t === "votes");
    assert.ok(votes.some((m) => m.count === 21), "geen bundelbericht met 21 stemmen");
    assert.ok(votes.length < 20, `te veel afzonderlijke berichten: ${votes.length}`);
    ws.close();
  });

  await step("sessie is live in de lijst", async () => {
    const r = await api("/api/sessions");
    assert.equal(r.body.find((s: any) => s.id === sessionId).state, "live");
  });

  await step("vernieuwen van een live sessie vraagt bevestiging", async () => {
    assert.equal((await api(`/api/sessions/${sessionId}/refresh`, { method: "POST" })).status, 409);
    assert.equal((await api(`/api/sessions/${sessionId}/refresh?force=1`, { method: "POST" })).status, 200);
  });

  await step("verwijderen van de sessie", async () => {
    assert.equal((await api(`/api/sessions/${sessionId}`, { method: "DELETE" })).status, 200);
    assert.equal((await api(`/api/sessions/${sessionId}`)).status, 404);
  });

  await step("verwijderen ruimt alles op", async () => {
    const del = await api(`/api/photos/${photoId}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal((await api(`/api/photos/${photoId}`)).status, 404);
    assert.equal((await api(`/api/analyses/${analysisId}`)).status, 404);
    assert.equal((await fetch(`${BASE}/api/photos/${photoId}/image`)).status, 404);
  });

  console.log(`\n${passed} stappen geslaagd.`);
  void VOTE;
}

main().catch(() => {
  process.exitCode = 1;
});
