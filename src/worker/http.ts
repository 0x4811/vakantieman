// Kleine HTTP-hulpjes voor de routes.

export function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Geeft een kopie van de respons met extra headers (respons van ASSETS.fetch is onveranderlijk). */
export function withHeaders(res: Response, headers: Record<string, string>): Response {
  const copy = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) copy.headers.set(k, v);
  return copy;
}

export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org wss: ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "child-src blob:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin"
};
