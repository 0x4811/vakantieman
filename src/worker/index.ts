// Beveiligde (privé) Worker: beheer, presentatie, bediening en de API.
// De publieke stempagina draait in een aparte Worker (src/vote), zodat deze Worker
// volledig achter Cloudflare Access kan zitten.

import { Hono } from "hono";
import { listProviders } from "./vision";
import { authenticate } from "./auth";
import type { AppContext } from "./env";
import { PAGE_CSP, SECURITY_HEADERS, withHeaders } from "./http";
import { analyses } from "./routes/analyses";
import { photos } from "./routes/photos";
import type { ProviderId, ConfigDto } from "../shared/types";
import type { AiBinding } from "./vision/types";

export { SessionRoom } from "./session-room";

const app = new Hono<AppContext>();

// Beveiligingskoppen op alle antwoorden.
app.use("*", async (c, next) => {
  await next();
  // Antwoorden van ASSETS.fetch hebben onveranderlijke headers, dus eerst kopiëren.
  // WebSocket-upgrades (101) blijven ongemoeid, anders gaat de socket verloren.
  if (c.res.status === 101) return;
  const res = new Response(c.res.body, c.res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
  c.res = res;
});

app.get("/healthz", (c) => c.text("ok"));

// Alles hieronder vereist een geldige Cloudflare Access-sessie (faalt gesloten).
app.use("*", async (c, next) => {
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth.ok) return c.json({ error: auth.reason }, auth.status);
  c.set("user", auth.user);

  // Eenvoudige CSRF-bescherming: wijzigende API-aanvragen moeten een eigen header meesturen.
  // Een andere website kan die header niet zetten zonder CORS-toestemming.
  if (c.req.path.startsWith("/api/") && c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("x-requested-with") !== "vakantieman") {
      return c.json({ error: "Ongeldige aanvraag." }, 403);
    }
  }
  await next();
});

const page =
  (path: string) =>
  async (c: { env: AppContext["Bindings"]; req: { url: string } }) => {
    const res = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
    return withHeaders(res, { "content-security-policy": PAGE_CSP, "cache-control": "no-store" });
  };

app.get("/", (c) => c.redirect("/admin"));
app.get("/admin", page("/admin"));
app.get("/present/:code", page("/present"));
app.get("/control/:code", page("/control"));
// Sjabloon voor de offline-speler (zonder gegevens); het beheerscherm vult het met een sessiepakket.
app.get("/offline-player", async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL("/offline-player", c.req.url)));
  return withHeaders(res, { "cache-control": "no-store" });
});
app.get("/assets/*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.get("/api/config", (c) => {
  const providers = listProviders(
    {
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
      GEMINI_API_KEY: c.env.GEMINI_API_KEY,
      AI: c.env.AI as unknown as AiBinding | undefined
    },
    c.env
  );
  const dto: ConfigDto = {
    user: c.get("user"),
    providers,
    default_provider: (c.env.VISION_PROVIDER || "mock") as ProviderId,
    default_model: c.env.VISION_MODEL || ""
  };
  return c.json(dto);
});

app.route("/api/photos", photos);
app.route("/api/analyses", analyses);

app.notFound((c) => c.json({ error: "Niet gevonden." }, 404));
app.onError((error, c) => {
  console.error("Onverwachte fout:", error);
  return c.json({ error: "Er ging iets mis aan de serverkant." }, 500);
});

export default { fetch: app.fetch };
