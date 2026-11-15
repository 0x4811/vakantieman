// Detailniveau per foto. Alles wat preciezer is dan het ingestelde niveau
// wordt verwijderd vóórdat een analyse wordt opgeslagen of getoond:
// velden, coördinaten en plaatsnamen in de lopende tekst.

import { clamp } from "./geo";
import type { Analysis, Candidate, RevealLevel } from "./types";

const RANK: Record<RevealLevel, number> = { country: 0, city: 1, district: 2, street: 3 };
const DECIMALS: Record<RevealLevel, number> = { country: 0, city: 1, district: 2, street: 4 };
const MIN_RADIUS_KM: Record<RevealLevel, number> = {
  country: 150,
  city: 10,
  district: 1.5,
  street: 0.05
};

export const REDACTED = "…";

export function roundCoord(value: number, level: RevealLevel): number {
  const f = 10 ** DECIMALS[level];
  return Math.round(value * f) / f;
}

export function minRadiusKm(level: RevealLevel): number {
  return MIN_RADIUS_KM[level];
}

/** Punt zoals het publiek het mag zien: afgerond op het niveau van de foto. */
export function publicPoint(
  lat: number,
  lon: number,
  level: RevealLevel
): { lat: number; lon: number; radius_km: number } {
  return {
    lat: roundCoord(lat, level),
    lon: roundCoord(lon, level),
    radius_km: MIN_RADIUS_KM[level]
  };
}

export function placeLabel(c: Pick<Candidate, "country" | "city" | "district" | "street">): string {
  return [c.street, c.district, c.city, c.country].filter((part) => part && part.trim()).join(", ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redact(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms) {
    out = out.replace(new RegExp(escapeRegExp(term), "gi"), REDACTED);
  }
  return out;
}

/**
 * Beperkt een analyse tot het gekozen detailniveau. Idempotent.
 * - Velden fijner dan het niveau worden leeggemaakt.
 * - Coördinaten worden afgerond en de onzekerheidsstraal krijgt een ondergrens.
 * - Namen van de verwijderde velden worden ook uit alle tekstvelden gehaald.
 */
export function applyRevealLevel(analysis: Analysis, level: RevealLevel): Analysis {
  const rank = RANK[level];

  const forbidden = new Map<string, string>();
  const allowed = new Set<string>();

  for (const c of analysis.candidates) {
    const parts: [string, number][] = [
      [c.country, 0],
      [c.city, 1],
      [c.district, 2],
      [c.street, 3]
    ];
    for (const [value, partRank] of parts) {
      const v = value.trim();
      if (v.length < 3) continue;
      if (partRank > rank) forbidden.set(v.toLowerCase(), v);
      else allowed.add(v.toLowerCase());
    }
  }

  const terms = [...forbidden.entries()]
    .filter(([key]) => !allowed.has(key))
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);

  const clean = (text: string): string => (terms.length > 0 ? redact(text, terms) : text);

  return {
    summary: clean(analysis.summary),
    overall_confidence: analysis.overall_confidence,
    clues: analysis.clues.map((clue) => ({
      ...clue,
      description: clean(clue.description),
      leak_advice: clean(clue.leak_advice)
    })),
    candidates: analysis.candidates.map((c) => ({
      ...c,
      city: rank >= 1 ? c.city : "",
      district: rank >= 2 ? c.district : "",
      street: rank >= 3 ? c.street : "",
      lat: roundCoord(c.lat, level),
      lon: roundCoord(c.lon, level),
      radius_km: clamp(Math.max(c.radius_km, MIN_RADIUS_KM[level]), MIN_RADIUS_KM[level], 6000),
      reasoning: clean(c.reasoning)
    }))
  };
}
