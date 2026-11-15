// Mock-provider: een vaste voorbeeldanalyse, zonder netwerk en zonder sleutels.
// Bedoeld om schermen, presentatie en tests te bouwen. De uitkomst heeft niets met de foto te maken.

import type { Analysis } from "../../shared/types";
import type { VisionProvider, VisionRequest, VisionResult } from "./types";

const ORIGINAL: Analysis = {
  summary:
    "Voorbeeldanalyse (mock): de combinatie van bakstenen gevels, fietsen, Nederlandstalige tekst en een vlak landschap wijst op een stad in België of Nederland.",
  overall_confidence: 0.72,
  clues: [
    {
      id: "c1",
      category: "taal",
      description: "Nederlandstalig bord boven een winkel (voorbeeld).",
      box: [0.08, 0.1, 0.38, 0.22],
      confidence: 0.8,
      leak_advice: "Houd winkelnamen en uithangborden buiten beeld."
    },
    {
      id: "c2",
      category: "architectuur",
      description: "Gevel van gele en rode baksteen met trapgevels (voorbeeld).",
      box: [0.55, 0.12, 0.95, 0.55],
      confidence: 0.7,
      leak_advice: "Neem selfies met een neutrale achtergrond, zoals een effen muur."
    },
    {
      id: "c3",
      category: "infrastructuur",
      description: "Tramrails en bovenleiding in de straat (voorbeeld).",
      box: [0.1, 0.7, 0.9, 0.92],
      confidence: 0.6,
      leak_advice: "Vermijd straatbeeld met rails, bovenleiding en verkeersborden."
    },
    {
      id: "c4",
      category: "orientatiepunt",
      description: "Een kerktoren in de verte door het raam (voorbeeld).",
      box: [0.42, 0.05, 0.52, 0.32],
      confidence: 0.55,
      leak_advice: "Sluit de gordijnen of kies een plek zonder uitzicht op herkenbare gebouwen."
    },
    {
      id: "c5",
      category: "zon_schaduw",
      description: "Schaduwlengte past bij de late middag in het najaar (voorbeeld).",
      box: null,
      confidence: 0.3,
      leak_advice: "Plaats selfies met enkele uren vertraging als je tijd en plek wilt loskoppelen."
    }
  ],
  candidates: [
    {
      id: "k1",
      country: "België",
      city: "Antwerpen",
      district: "Zuid",
      street: "Leopold De Waelplaats",
      lat: 51.2125,
      lon: 4.3952,
      radius_km: 2,
      confidence: 0.62,
      reasoning:
        "Tram, trapgevels en het Nederlandstalige bord passen goed bij het centrum van Antwerpen (voorbeeld).",
      supporting_clue_ids: ["c1", "c2", "c3", "c4"]
    },
    {
      id: "k2",
      country: "België",
      city: "Gent",
      district: "Centrum",
      street: "Korenmarkt",
      lat: 51.0543,
      lon: 3.7217,
      radius_km: 3,
      confidence: 0.24,
      reasoning: "Vergelijkbare architectuur en tram, maar minder passend bij het uitzicht (voorbeeld).",
      supporting_clue_ids: ["c2", "c3"]
    },
    {
      id: "k3",
      country: "Nederland",
      city: "Rotterdam",
      district: "Centrum",
      street: "Coolsingel",
      lat: 51.9225,
      lon: 4.4792,
      radius_km: 8,
      confidence: 0.1,
      reasoning: "Nederlandstalig en tram, maar de gevels wijken af (voorbeeld).",
      supporting_clue_ids: ["c1", "c3"]
    }
  ]
};

const MASKED: Analysis = {
  summary:
    "Voorbeeldanalyse (mock) van de bewerkte foto: met de tekst, de gevel en het uitzicht afgedekt blijft er te weinig over voor een betrouwbaar antwoord.",
  overall_confidence: 0.12,
  clues: [
    {
      id: "c1",
      category: "zon_schaduw",
      description: "Alleen de schaduwlengte is nog zichtbaar; die zegt weinig over de plek (voorbeeld).",
      box: null,
      confidence: 0.2,
      leak_advice: "Dit detail is onschuldig zolang de rest verborgen blijft."
    }
  ],
  candidates: [
    {
      id: "k1",
      country: "België",
      city: "",
      district: "",
      street: "",
      lat: 50.8,
      lon: 4.4,
      radius_km: 400,
      confidence: 0.12,
      reasoning: "Een brede gok in West-Europa; er is niets dat een stad of straat aanwijst (voorbeeld).",
      supporting_clue_ids: ["c1"]
    }
  ]
};

export function mockProvider(): VisionProvider {
  return {
    id: "mock",
    label: "Mock (voorbeeldanalyse)",
    defaultModel: "mock-1",
    async analyze(request: VisionRequest): Promise<VisionResult> {
      const started = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const base = request.variant === "masked" ? MASKED : ORIGINAL;
      return {
        analysis: structuredClone(base),
        provider: "mock",
        model: request.model || "mock-1",
        latencyMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0
      };
    }
  };
}
