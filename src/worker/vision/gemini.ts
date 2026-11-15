// Adapter voor de Gemini API (generateContent, JSON-uitvoer).

import { extractJson, normalizeAnalysis } from "../../shared/analysis";
import { describeHttpError, IMAGE_PLACEHOLDER, jsonBodyWithImage } from "./http";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { ProviderError, type ProviderConfig, type VisionProvider, type VisionRequest, type VisionResult } from "./types";

// Controleer de actuele modelnamen in Google AI Studio; dit is alleen de standaard.
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function geminiProvider(config: ProviderConfig): VisionProvider {
  const doFetch = config.fetch ?? fetch;
  return {
    id: "gemini",
    label: "Gemini (Google AI)",
    defaultModel: GEMINI_DEFAULT_MODEL,
    async analyze(request: VisionRequest): Promise<VisionResult> {
      if (!config.GEMINI_API_KEY) {
        throw new ProviderError("GEMINI_API_KEY is niet ingesteld.", 503);
      }
      const model = request.model || GEMINI_DEFAULT_MODEL;

      const template = {
        systemInstruction: { parts: [{ text: buildSystemPrompt(request) }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: request.mime, data: IMAGE_PLACEHOLDER } },
              { text: buildUserPrompt(request, "norm1000", true) }
            ]
          }
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 8192 }
      };

      const started = Date.now();
      const res = await doFetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
        body: jsonBodyWithImage(template, request.imageBase64)
      });
      if (!res.ok) throw await describeHttpError("Gemini", res);

      const body = (await res.json()) as GeminiResponse;
      if (body.promptFeedback?.blockReason) {
        throw new ProviderError(`Gemini blokkeerde de aanvraag (${body.promptFeedback.blockReason}).`, 422);
      }
      const candidate = body.candidates?.[0];
      const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      if (!text) {
        throw new ProviderError(
          `Gemini gaf geen antwoord${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}.`,
          502
        );
      }

      const analysis = normalizeAnalysis(extractJson(text), {
        boxFormat: "norm1000_yxyx",
        width: request.width,
        height: request.height
      });

      return {
        analysis,
        provider: "gemini",
        model,
        latencyMs: Date.now() - started,
        inputTokens: body.usageMetadata?.promptTokenCount ?? null,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? null
      };
    }
  };
}
