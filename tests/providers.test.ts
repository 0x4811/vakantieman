import { describe, expect, it } from "vitest";
import { jsonBodyWithImage, IMAGE_PLACEHOLDER } from "../src/worker/vision/http";
import { claudeProvider } from "../src/worker/vision/claude";
import { geminiProvider } from "../src/worker/vision/gemini";
import { workersAiProvider } from "../src/worker/vision/workers-ai";
import { mockProvider } from "../src/worker/vision/mock";
import { isProviderAllowed, listProviders } from "../src/worker/vision";
import { ProviderError, type VisionRequest } from "../src/worker/vision/types";

const IMAGE = "QUJD".repeat(50_000); // 200 kB aan base64-tekens
const request: VisionRequest = {
  imageBase64: IMAGE,
  mime: "image/jpeg",
  width: 1000,
  height: 500,
  revealLevel: "city",
  variant: "original"
};

const rawPixels = {
  summary: "Test",
  overall_confidence: 0.6,
  clues: [{ category: "taal", description: "Bord", box: [100, 50, 500, 250], confidence: 0.8, leak_advice: "Niet tonen" }],
  candidates: [
    { country: "België", city: "Antwerpen", district: "", street: "", lat: 51.2, lon: 4.4, radius_km: 5, confidence: 0.7, reasoning: "r", supporting_clues: [1] }
  ]
};
const rawNorm = { ...rawPixels, clues: [{ ...rawPixels.clues[0], box: [100, 200, 500, 800] }] };

interface Captured {
  url: string;
  init: RequestInit;
}
function fakeFetch(responseBody: unknown, status = 200): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(responseBody), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

describe("jsonBodyWithImage", () => {
  it("levert geldige JSON met de afbeelding op de juiste plek", () => {
    const body = jsonBodyWithImage({ a: "x\"y", img: { data: IMAGE_PLACEHOLDER }, b: [1, 2] }, IMAGE);
    const parsed = JSON.parse(body);
    expect(parsed.img.data).toBe(IMAGE);
    expect(parsed.a).toBe('x"y');
    expect(parsed.b).toEqual([1, 2]);
  });
  it("weigert een sjabloon zonder plaatsmarkering", () => {
    expect(() => jsonBodyWithImage({ a: 1 }, IMAGE)).toThrow();
  });
});

describe("Claude-adapter", () => {
  it("stuurt een correcte aanvraag en verwerkt het antwoord", async () => {
    const { fetch, calls } = fakeFetch({
      content: [{ type: "text", text: JSON.stringify(rawPixels) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1500, output_tokens: 300 }
    });
    const result = await claudeProvider({ ANTHROPIC_API_KEY: "sk-test", fetch }).analyze(request);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: IMAGE }
    });
    expect(body.messages[0].content[1].type).toBe("text"); // afbeelding vóór tekst
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.system).toContain("CITY level");

    expect(result.provider).toBe("claude");
    expect(result.inputTokens).toBe(1500);
    expect(result.outputTokens).toBe(300);
    expect(result.analysis.clues[0].box).toEqual([0.1, 0.1, 0.5, 0.5]);
    expect(result.analysis.candidates[0].supporting_clue_ids).toEqual(["c1"]);
  });

  it("gebruikt een eigen model als dat is opgegeven", async () => {
    const { fetch, calls } = fakeFetch({ content: [{ type: "text", text: JSON.stringify(rawPixels) }] });
    await claudeProvider({ ANTHROPIC_API_KEY: "k", fetch }).analyze({ ...request, model: "claude-opus-5-5" });
    expect(JSON.parse(calls[0].init.body as string).model).toBe("claude-opus-5-5");
  });

  it("geeft een duidelijke fout zonder sleutel, bij weigering en bij een HTTP-fout", async () => {
    await expect(claudeProvider({}).analyze(request)).rejects.toThrow(/ANTHROPIC_API_KEY/);

    const refusal = fakeFetch({ content: [], stop_reason: "refusal" });
    await expect(claudeProvider({ ANTHROPIC_API_KEY: "k", fetch: refusal.fetch }).analyze(request)).rejects.toThrow(/weigerde/);

    const unauthorized = fakeFetch({ error: { message: "invalid x-api-key" } }, 401);
    const err = await claudeProvider({ ANTHROPIC_API_KEY: "geheim", fetch: unauthorized.fetch })
      .analyze(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("geheim"); // sleutel lekt nooit in een foutmelding
  });
});

describe("Gemini-adapter", () => {
  it("stuurt een correcte aanvraag en rekent Gemini-kaders om", async () => {
    const { fetch, calls } = fakeFetch({
      candidates: [{ content: { parts: [{ text: JSON.stringify(rawNorm) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 200 }
    });
    const result = await geminiProvider({ GEMINI_API_KEY: "g-test", fetch }).analyze(request);

    expect(calls[0].url).toContain("/models/gemini-3.8-flash:generateContent");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-test");
    expect(calls[0].url).not.toContain("g-test"); // sleutel niet in de URL

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/jpeg", data: IMAGE });
    expect(body.generationConfig.responseMimeType).toBe("application/json");

    expect(result.provider).toBe("gemini");
    expect(result.analysis.clues[0].box).toEqual([0.2, 0.1, 0.8, 0.5]);
    expect(result.inputTokens).toBe(800);
  });

  it("meldt een geblokkeerde aanvraag en een leeg antwoord", async () => {
    const blocked = fakeFetch({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(geminiProvider({ GEMINI_API_KEY: "k", fetch: blocked.fetch }).analyze(request)).rejects.toThrow(/blokkeerde/);
    const empty = fakeFetch({ candidates: [{ finishReason: "MAX_TOKENS" }] });
    await expect(geminiProvider({ GEMINI_API_KEY: "k", fetch: empty.fetch }).analyze(request)).rejects.toThrow(/geen antwoord/);
    await expect(geminiProvider({}).analyze(request)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe("Workers AI-adapter", () => {
  it("werkt via de binding, ook als het model een object teruggeeft", async () => {
    let seen: { model: string; input: any } | undefined;
    const AI = {
      async run(model: string, input: unknown) {
        seen = { model, input };
        return { response: rawNorm, usage: { prompt_tokens: 10, completion_tokens: 5 } };
      }
    };
    const result = await workersAiProvider({ AI }).analyze(request);
    expect(seen?.model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(seen?.input.messages[1].content[1].image_url.url).toBe(`data:image/jpeg;base64,${IMAGE}`);
    expect(result.analysis.candidates).toHaveLength(1);
    expect(result.outputTokens).toBe(5);
  });

  it("werkt via REST en haalt JSON uit een tekstantwoord", async () => {
    const { fetch, calls } = fakeFetch({ result: { response: "Hier is het:\n```json\n" + JSON.stringify(rawNorm) + "\n```" } });
    const result = await workersAiProvider({ CF_ACCOUNT_ID: "acc", CF_API_TOKEN: "tok", fetch }).analyze(request);
    expect(calls[0].url).toContain("/accounts/acc/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(result.analysis.clues).toHaveLength(1);
  });

  it("meldt dat er niets gekoppeld is", async () => {
    await expect(workersAiProvider({}).analyze(request)).rejects.toThrow(/niet gekoppeld/);
  });
});

describe("mock-provider", () => {
  it("geeft een voorbeeldanalyse en een onzekere variant voor de bewerkte foto", async () => {
    const original = await mockProvider().analyze(request);
    expect(original.analysis.candidates[0].city).toBe("Antwerpen");
    const masked = await mockProvider().analyze({ ...request, variant: "masked" });
    expect(masked.analysis.overall_confidence).toBeLessThan(0.3);
  });
});

describe("beleid voor gevoelige foto's", () => {
  it("laat publieke foto's naar elke provider gaan", () => {
    expect(isProviderAllowed("gemini", "public", {})).toEqual({ allowed: true });
  });
  it("laat privéfoto's standaard alleen naar claude en mock", () => {
    expect(isProviderAllowed("claude", "private", {})).toEqual({ allowed: true });
    expect(isProviderAllowed("gemini", "private", {}).allowed).toBe(false);
    expect(isProviderAllowed("workers-ai", "private", {}).allowed).toBe(false);
  });
  it("staat Gemini voor privéfoto's alleen toe in een betaald project", () => {
    expect(isProviderAllowed("gemini", "private", { PRIVATE_PROVIDERS: "claude,gemini" }).allowed).toBe(false);
    expect(isProviderAllowed("gemini", "private", { PRIVATE_PROVIDERS: "claude,gemini", GEMINI_PAID: "true" }).allowed).toBe(true);
  });
  it("meldt beschikbaarheid per provider", () => {
    const list = listProviders({ ANTHROPIC_API_KEY: "k" }, {});
    expect(list.find((p) => p.id === "claude")?.available).toBe(true);
    expect(list.find((p) => p.id === "gemini")?.available).toBe(false);
    expect(list.find((p) => p.id === "mock")?.allowed_for_private).toBe(true);
  });
});
