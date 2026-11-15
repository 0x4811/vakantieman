// Bindings en instellingen van de beveiligde (privé) Worker.

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  SESSIONS: DurableObjectNamespace;
  AI?: Ai;

  VISION_PROVIDER: string;
  VISION_MODEL: string;
  VISION_FALLBACK: string;
  PRIVATE_PROVIDERS: string;

  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_PAID?: string;

  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;

  /** Basis-URL van de publieke stem-Worker (voor de QR-code). */
  PUBLIC_VOTE_URL?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { user: string };
};

/** Bovengrens voor een geüploade foto (na verkleinen is een foto ruim kleiner dan dit). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** Bovengrens voor de base64-tekst bij een analyse (ongeveer 10 MB aan beeld). */
export const MAX_BASE64_CHARS = 14_000_000;
