// Gemeenschappelijke interface voor alle beeldmodellen.
// Draait in de Worker én in Node (bench-script), dus zonder omgevingsspecifieke types.

import type { Analysis, ProviderId, RevealLevel, Variant } from "../../shared/types";

export interface VisionRequest {
  /** JPEG als base64-string (zonder data-URL-prefix). */
  imageBase64: string;
  mime: "image/jpeg";
  /** Afmetingen van de afbeelding zoals verstuurd. */
  width: number;
  height: number;
  revealLevel: RevealLevel;
  variant: Variant;
  /** Leeg of weggelaten: standaardmodel van de provider. */
  model?: string;
}

export interface VisionResult {
  /** Genormaliseerd, maar nog NIET beperkt tot het detailniveau. */
  analysis: Analysis;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface VisionProvider {
  id: ProviderId;
  label: string;
  defaultModel: string;
  analyze(request: VisionRequest): Promise<VisionResult>;
}

/** Minimale vorm van de Workers AI-binding, zodat dit bestand geen workers-types nodig heeft. */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface ProviderConfig {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Workers AI via binding (in de Worker). */
  AI?: AiBinding;
  /** Workers AI via REST (bench-script). */
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  /** Voor tests: eigen fetch. */
  fetch?: typeof fetch;
}

/** Fout van een provider met een leesbare, veilige melding (nooit met sleutels erin). */
export class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}
