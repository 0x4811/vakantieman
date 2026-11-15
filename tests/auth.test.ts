import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate, resetAuthCacheForTests } from "../src/worker/auth";

const TEAM = "voorbeeld.cloudflareaccess.com";
const AUD = "aud-123";

let privateKey: CryptoKey;
let jwk: Record<string, unknown>;

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function sign(payload: Record<string, unknown>, kid = "k1", key = privateKey): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

const now = () => Math.floor(Date.now() / 1000);
const goodPayload = () => ({ iss: `https://${TEAM}`, aud: [AUD], exp: now() + 600, email: "wouter@example.com" });

const jwksFetch = (async () =>
  new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] }), { status: 200 })) as unknown as typeof fetch;

const req = (token?: string, url = "https://vakantieman.example/admin") =>
  new Request(url, { headers: token ? { "cf-access-jwt-assertion": token } : {} });

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  privateKey = pair.privateKey;
  jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as unknown as Record<string, unknown>;
});

beforeEach(() => resetAuthCacheForTests());

describe("authenticate met Cloudflare Access", () => {
  it("accepteert een geldig token", async () => {
    const r = await authenticate(req(await sign(goodPayload())), env, jwksFetch);
    expect(r).toEqual({ ok: true, user: "wouter@example.com" });
  });

  it("weigert zonder token", async () => {
    const r = await authenticate(req(), env, jwksFetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("weigert een verlopen token", async () => {
    const r = await authenticate(req(await sign({ ...goodPayload(), exp: now() - 10 })), env, jwksFetch);
    expect(r.ok).toBe(false);
  });

  it("weigert een verkeerde doelgroep of uitgever", async () => {
    expect((await authenticate(req(await sign({ ...goodPayload(), aud: ["anders"] })), env, jwksFetch)).ok).toBe(false);
    expect((await authenticate(req(await sign({ ...goodPayload(), iss: "https://kwaad.example" })), env, jwksFetch)).ok).toBe(false);
  });

  it("weigert een token met een vervalste handtekening", async () => {
    const other = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"]
    );
    const r = await authenticate(req(await sign(goodPayload(), "k1", other.privateKey)), env, jwksFetch);
    expect(r.ok).toBe(false);
  });

  it("weigert een onbekende sleutel-id en alg=none", async () => {
    expect((await authenticate(req(await sign(goodPayload(), "onbekend")), env, jwksFetch)).ok).toBe(false);
    const none = `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(goodPayload()))}.`;
    expect((await authenticate(req(none), env, jwksFetch)).ok).toBe(false);
  });

  it("negeert de dev-bypass zodra Access is ingesteld", async () => {
    const r = await authenticate(req(undefined, "http://localhost:8787/admin"), { ...env, DEV_AUTH_BYPASS: "1" }, jwksFetch);
    expect(r.ok).toBe(false);
  });
});

describe("authenticate zonder Access", () => {
  it("faalt gesloten zonder configuratie", async () => {
    const r = await authenticate(req(), {}, jwksFetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it("staat de bypass alleen op localhost toe", async () => {
    expect((await authenticate(req(undefined, "http://localhost:8787/"), { DEV_AUTH_BYPASS: "1" })).ok).toBe(true);
    expect((await authenticate(req(undefined, "https://vakantieman.example/"), { DEV_AUTH_BYPASS: "1" })).ok).toBe(false);
  });
});
