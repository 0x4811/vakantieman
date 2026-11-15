import { Hono } from "hono";
import { wipeEverything } from "../cleanup";
import type { AppContext } from "../env";

export const admin = new Hono<AppContext>();

export const WIPE_CONFIRMATION = "ALLES WISSEN";

admin.post("/wipe", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== WIPE_CONFIRMATION) return c.json({ error: `Typ "${WIPE_CONFIRMATION}" om te bevestigen.` }, 400);
  return c.json(await wipeEverything(c.env));
});
