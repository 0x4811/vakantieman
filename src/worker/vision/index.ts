// Providerregister: kiezen, beschikbaarheid en beleid voor gevoelige foto's.

import type { ProviderId, ProviderInfo, Sensitivity } from "../../shared/types";
import { claudeProvider, CLAUDE_DEFAULT_MODEL } from "./claude";
import { geminiProvider, GEMINI_DEFAULT_MODEL } from "./gemini";
import { mockProvider } from "./mock";
import { ProviderError, type ProviderConfig, type VisionProvider } from "./types";
import { workersAiProvider, WORKERS_AI_DEFAULT_MODEL } from "./workers-ai";

export type { ProviderConfig, VisionProvider, VisionRequest, VisionResult } from "./types";
export { ProviderError } from "./types";

export interface PolicyConfig {
  /** Kommagescheiden lijst van providers die "private" foto's mogen ontvangen. */
  PRIVATE_PROVIDERS?: string;
  /** "true" als het Gemini-project betaald is (gegevens niet voor training). */
  GEMINI_PAID?: string;
}

export function createProvider(id: ProviderId, config: ProviderConfig): VisionProvider {
  switch (id) {
    case "claude":
      return claudeProvider(config);
    case "gemini":
      return geminiProvider(config);
    case "workers-ai":
      return workersAiProvider(config);
    case "mock":
      return mockProvider();
  }
}

export function privateProviders(policy: PolicyConfig): Set<string> {
  const list = (policy.PRIVATE_PROVIDERS ?? "claude,mock")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(list);
}

/** Mag deze provider een foto met deze gevoeligheid ontvangen? */
export function isProviderAllowed(
  id: ProviderId,
  sensitivity: Sensitivity,
  policy: PolicyConfig
): { allowed: true } | { allowed: false; reason: string } {
  if (sensitivity === "public") return { allowed: true };
  if (privateProviders(policy).has(id)) {
    if (id === "gemini" && policy.GEMINI_PAID !== "true") {
      return {
        allowed: false,
        reason:
          "Gemini staat in de lijst voor privéfoto's, maar GEMINI_PAID is niet 'true': de gratis laag gebruikt gegevens om producten te verbeteren."
      };
    }
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Deze foto is als privé gemarkeerd en mag niet naar ${id}. Pas PRIVATE_PROVIDERS aan als de voorwaarden van die provider dat toelaten.`
  };
}

export function listProviders(config: ProviderConfig, policy: PolicyConfig): ProviderInfo[] {
  const priv = privateProviders(policy);
  const entries: Omit<ProviderInfo, "allowed_for_private">[] = [
    {
      id: "claude",
      label: "Claude (Anthropic API)",
      default_model: CLAUDE_DEFAULT_MODEL,
      available: Boolean(config.ANTHROPIC_API_KEY),
      note: config.ANTHROPIC_API_KEY ? "" : "ANTHROPIC_API_KEY ontbreekt"
    },
    {
      id: "gemini",
      label: "Gemini (Google AI)",
      default_model: GEMINI_DEFAULT_MODEL,
      available: Boolean(config.GEMINI_API_KEY),
      note: config.GEMINI_API_KEY ? "" : "GEMINI_API_KEY ontbreekt"
    },
    {
      id: "workers-ai",
      label: "Cloudflare Workers AI",
      default_model: WORKERS_AI_DEFAULT_MODEL,
      available: Boolean(config.AI),
      note: config.AI ? "" : "AI-binding ontbreekt in wrangler.jsonc"
    },
    {
      id: "mock",
      label: "Mock (voorbeeldanalyse)",
      default_model: "mock-1",
      available: true,
      note: "Vaste voorbeeldanalyse, geen echte beeldanalyse"
    }
  ];
  return entries.map((entry) => ({
    ...entry,
    allowed_for_private:
      priv.has(entry.id) && (entry.id !== "gemini" || policy.GEMINI_PAID === "true")
  }));
}

export function assertProvider(id: string): ProviderId {
  if (id === "claude" || id === "gemini" || id === "workers-ai" || id === "mock") return id;
  throw new ProviderError(`Onbekende provider: ${id}`, 400);
}
