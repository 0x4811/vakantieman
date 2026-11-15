// Toegangscontrole: Cloudflare Access (JWT in `Cf-Access-Jwt-Assertion`) met eigen verificatie
// in de Worker, zodat een foutieve Access-instelling nooit tot open routes leidt.
// Faalt gesloten: zonder configuratie zijn beschermde routes niet bereikbaar.

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
}

export type AuthResult =
  | { ok: true; user: string }
  | { ok: false; status: 401 | 403 | 503; reason: string };

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

export function resetAuthCacheForTests(): void {
  jwksCache.clear();
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as T;
}

function normalizeTeamDomain(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function getKeys(team: string, fetchImpl: typeof fetch, force = false): Promise<Jwk[]> {
  const cached = jwksCache.get(team);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetchImpl(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS ophalen mislukt (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(team, { keys, fetchedAt: Date.now() });
  return keys;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export async function verifyAccessJwt(
  token: string,
  env: Required<Pick<AuthEnv, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">>,
  fetchImpl: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Ongeldig token." };
  const [h, p, s] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string; common_name?: string };
  try {
    header = decodeJson(h);
    payload = decodeJson(p);
  } catch {
    return { ok: false, reason: "Ongeldig token." };
  }
  if (header.alg !== "RS256") return { ok: false, reason: "Niet-ondersteund algoritme." };

  const team = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);

  let keys: Jwk[];
  try {
    keys = await getKeys(team, fetchImpl);
    if (!keys.some((k) => k.kid === header.kid)) keys = await getKeys(team, fetchImpl, true);
  } catch {
    return { ok: false, reason: "Sleutels van Cloudflare Access niet bereikbaar." };
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: "Onbekende sleutel." };

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!valid) return { ok: false, reason: "Ongeldige handtekening." };

  if (payload.iss !== `https://${team}`) return { ok: false, reason: "Onjuiste uitgever." };
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!aud.includes(env.ACCESS_AUD)) return { ok: false, reason: "Onjuiste doelgroep (aud)." };
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return { ok: false, reason: "Token verlopen." };
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds + 30) return { ok: false, reason: "Token nog niet geldig." };

  return { ok: true, email: payload.email ?? payload.common_name ?? "onbekend" };
}

export async function authenticate(
  request: Request,
  env: AuthEnv,
  fetchImpl: typeof fetch = fetch
): Promise<AuthResult> {
  if (env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN) {
    const token =
      request.headers.get("cf-access-jwt-assertion") ??
      readCookie(request.headers.get("cookie"), "CF_Authorization");
    if (!token) return { ok: false, status: 401, reason: "Niet ingelogd." };
    const result = await verifyAccessJwt(
      token,
      { ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN, ACCESS_AUD: env.ACCESS_AUD },
      fetchImpl
    );
    if (!result.ok) return { ok: false, status: 403, reason: result.reason };
    return { ok: true, user: result.email };
  }

  // Alleen lokaal: bypass werkt nooit zodra Access is ingesteld en nooit buiten localhost.
  if (env.DEV_AUTH_BYPASS === "1") {
    const host = new URL(request.url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      return { ok: true, user: "lokaal" };
    }
  }

  return {
    ok: false,
    status: 503,
    reason: "Toegangscontrole is niet ingesteld. Zie docs/INRICHTING.md (ACCESS_TEAM_DOMAIN en ACCESS_AUD)."
  };
}
