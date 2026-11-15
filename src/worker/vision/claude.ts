// Adapter voor de Claude API (Messages API met gestructureerde uitvoer).

import { ANALYSIS_JSON_SCHEMA, extractJson, normalizeAnalysis } from "../../shared/analysis";
import { describeHttpError, IMAGE_PLACEHOLDER, jsonBodyWithImage } from "./http";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { ProviderError, type ProviderConfig, type VisionProvider, type VisionRequest, type VisionResult } from "./types";

export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

interface ClaudeResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function claudeProvider(config: ProviderConfig): VisionProvider {
  const doFetch = config.fetch ?? fetch;
  return {
    id: "claude",
    label: "Claude (Anthropic API)",
    defaultModel: CLAUDE_DEFAULT_MODEL,
    async analyze(request: VisionRequest): Promise<VisionResult> {
      if (!config.ANTHROPIC_API_KEY) {
        throw new ProviderError("ANTHROPIC_API_KEY is niet ingesteld.", 503);
      }
      const model = request.model || CLAUDE_DEFAULT_MODEL;

      // Afbeelding vóór de tekst, zoals Anthropic aanraadt.
      const template = {
        model,
        max_tokens: 4096,
        system: buildSystemPrompt(request),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: request.mime, data: IMAGE_PLACEHOLDER }
              },
              { type: "text", text: buildUserPrompt(request, "pixels", false) }
            ]
          }
        ],
        output_config: { format: { type: "json_schema", schema: ANALYSIS_JSON_SCHEMA } }
      };

      const started = Date.now();
      const res = await doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: jsonBodyWithImage(template, request.imageBase64)
      });
      if (!res.ok) throw await describeHttpError("Claude", res);

      const body = (await res.json()) as ClaudeResponse;
      if (body.stop_reason === "refusal") {
        throw new ProviderError("Claude weigerde deze afbeelding te analyseren.", 422);
      }
      if (body.stop_reason === "max_tokens") {
        throw new ProviderError("Het antwoord van Claude werd afgekapt. Probeer het opnieuw.", 502);
      }
      const text = (body.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");

      const analysis = normalizeAnalysis(extractJson(text), {
        boxFormat: "pixels_xyxy",
        width: request.width,
        height: request.height
      });

      return {
        analysis,
        provider: "claude",
        model,
        latencyMs: Date.now() - started,
        inputTokens: body.usage?.input_tokens ?? null,
        outputTokens: body.usage?.output_tokens ?? null
      };
    }
  };
}
