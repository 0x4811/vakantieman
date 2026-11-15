// Prompts voor de beeldanalyse. Eén bron, zodat alle providers dezelfde opdracht krijgen.

import { CLUE_CATEGORIES, type RevealLevel } from "../../shared/types";
import type { VisionRequest } from "./types";

const LEVEL_RULES: Record<RevealLevel, string> = {
  country:
    "Only the COUNTRY level is allowed. Leave city, district and street as empty strings, and do not mention any city, district or street name anywhere in your text; describe such things generically (for example 'a street sign').",
  city:
    "Only up to CITY level is allowed. Leave district and street as empty strings, and do not mention any district or street name anywhere in your text; describe such things generically.",
  district:
    "Only up to DISTRICT level is allowed. Leave street as an empty string, and do not mention any street name or house number anywhere in your text; describe such things generically.",
  street: "Full detail is allowed, down to street level."
};

export function buildSystemPrompt(request: Pick<VisionRequest, "revealLevel">): string {
  return [
    "You are a visual geolocation analyst supporting a security-awareness demonstration.",
    "The demonstrator took the photo themselves and owns it. The audience first tries to guess where it was taken; your analysis then shows what the image gives away, and how to prevent that.",
    "",
    "Your task: (1) list the visible clues that reveal the location, and (2) propose candidate locations.",
    "",
    "Rules:",
    "- Use only what is visible in the image. There is no metadata.",
    "- Do not identify or describe the person. Consider only what the image reveals about the place.",
    "- Be honest about uncertainty. If the image offers little to go on, say so, give broad candidates with a large radius_km, or give no candidates. Never invent details.",
    "- Write all text fields in Dutch.",
    "- For every clue add leak_advice: one short, practical sentence on how to avoid giving this away.",
    "- Detail limit: " + LEVEL_RULES[request.revealLevel],
    "- Give at most 5 candidates, ordered by confidence. confidence is a number between 0 and 1.",
    "- radius_km is the uncertainty radius around the lat/lon of the candidate."
  ].join("\n");
}

export type BoxStyle = "pixels" | "norm1000";

function boxInstruction(style: BoxStyle, width: number, height: number): string {
  if (style === "pixels") {
    return `For box give [x1, y1, x2, y2] in pixel coordinates of this image (origin top-left, width ${width}, height ${height}), or an empty array when the clue has no specific place in the image.`;
  }
  return "For box give [ymin, xmin, ymax, xmax] with values from 0 to 1000 relative to the image size (origin top-left), or an empty array when the clue has no specific place in the image.";
}

const JSON_SHAPE = `{
  "summary": "korte samenvatting van de redenering",
  "overall_confidence": 0.0,
  "clues": [
    { "category": "<categorie>", "description": "...", "box": [], "confidence": 0.0, "leak_advice": "..." }
  ],
  "candidates": [
    { "country": "", "city": "", "district": "", "street": "", "lat": 0.0, "lon": 0.0, "radius_km": 0.0,
      "confidence": 0.0, "reasoning": "...", "supporting_clues": [1, 2] }
  ]
}`;

export function buildUserPrompt(
  request: Pick<VisionRequest, "width" | "height" | "variant">,
  style: BoxStyle,
  includeJsonShape: boolean
): string {
  const parts = [
    `Image size: ${request.width} x ${request.height} pixels.`,
    "Analyse this photo: which clues reveal where it was taken, and where was it most likely taken?",
    boxInstruction(style, request.width, request.height),
    `Allowed categories: ${CLUE_CATEGORIES.join(", ")}.`,
    "supporting_clues lists the 1-based numbers of the clues (in the order you list them) that support a candidate."
  ];
  if (request.variant === "masked") {
    parts.push(
      "This version of the photo had revealing details deliberately blurred or covered. Analyse it in exactly the same way, and be honest if what remains does not allow a confident answer."
    );
  }
  if (includeJsonShape) {
    parts.push(
      "Answer with ONLY one JSON object and nothing else, in exactly this shape:",
      JSON_SHAPE
    );
  }
  return parts.join("\n");
}
