// Adapter voor Cloudflare Workers AI: via de AI-binding (Worker) of via REST (bench-script).
// Kaders zijn bij deze modellen niet gegarandeerd; de normalisatie laat ze weg als ze niet kloppen.

import { extractJson, normalizeAnalysis } from "../../shared/analysis";
import { describeHttpError } from "./http";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { ProviderError, type ProviderConfig, type VisionProvider, type VisionRequest, type VisionResult } from "./types";

export const WORKERS_AI_DEFAULT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

interface WorkersAiOutput {
  response?: unknown;
  result?: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function workersAiProvider(config: ProviderConfig): VisionProvider {
  const doFetch = config.fetch ?? fetch;
  return {
    id: "workers-ai",
    label: "Cloudflare Workers AI",
    defaultModel: WORKERS_AI_DEFAULT_MODEL,
    async analyze(request: VisionRequest): Promise<VisionResult> {
      const model = request.model || WORKERS_AI_DEFAULT_MODEL;
      const input = {
        messages: [
          { role: "system", content: buildSystemPrompt(request) },
          {
            role: "user",
            content: [
              { type: "text", text: buildUserPrompt(request, "norm1000", true) },
              { type: "image_url", image_url: { url: `data:${request.mime};base64,${request.imageBase64}` } }
            ]
          }
        ],
        max_tokens: 2048,
        temperature: 0.2
      };

      const started = Date.now();
      let output: WorkersAiOutput;

      if (config.AI) {
        output = (await config.AI.run(model, input)) as WorkersAiOutput;
      } else if (config.CF_ACCOUNT_ID && config.CF_API_TOKEN) {
        const res = await doFetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.CF_ACCOUNT_ID)}/ai/run/${model}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${config.CF_API_TOKEN}` },
            body: JSON.stringify(input)
          }
        );
        if (!res.ok) throw await describeHttpError("Workers AI", res);
        output = (await res.json()) as WorkersAiOutput;
      } else {
        throw new ProviderError("Workers AI is niet gekoppeld (geen AI-binding en geen CF_ACCOUNT_ID/CF_API_TOKEN).", 503);
      }

      const response = output.response ?? output.result?.response;
      const usage = output.usage ?? output.result?.usage;
      let raw: unknown;
      if (typeof response === "string") raw = extractJson(response);
      else if (response && typeof response === "object") raw = response;
      else throw new ProviderError("Workers AI gaf geen bruikbaar antwoord.", 502);

      const analysis = normalizeAnalysis(raw, {
        boxFormat: "norm1000_yxyx",
        width: request.width,
        height: request.height
      });

      return {
        analysis,
        provider: "workers-ai",
        model,
        latencyMs: Date.now() - started,
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null
      };
    }
  };
}
