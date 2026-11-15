// HTTP-hulpjes voor de adapters.

import { ProviderError } from "./types";

const PLACEHOLDER = "__IMAGE_BASE64__";

/**
 * Bouwt een JSON-body waarin de (grote) base64-afbeelding door stringconcatenatie
 * wordt ingevoegd, niet door JSON.stringify. Base64 bevat geen tekens die geëscaped
 * moeten worden. Dat scheelt CPU-tijd in de Worker (gratis plan: 10 ms per verzoek).
 * Zet PLACEHOLDER op de plek waar de afbeelding hoort.
 */
export function jsonBodyWithImage(template: unknown, imageBase64: string): string {
  const json = JSON.stringify(template);
  const marker = `"${PLACEHOLDER}"`;
  const at = json.indexOf(marker);
  if (at === -1) throw new Error("Sjabloon bevat geen afbeeldingsplaats.");
  return json.slice(0, at) + '"' + imageBase64 + '"' + json.slice(at + marker.length);
}

export const IMAGE_PLACEHOLDER = PLACEHOLDER;

/** Leest een foutantwoord leesbaar uit, zonder gevoelige gegevens te lekken. */
export async function describeHttpError(provider: string, res: Response): Promise<ProviderError> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      const err = parsed.error;
      detail =
        (typeof err === "string" ? err : err?.message) ?? parsed.message ?? text.slice(0, 200);
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    // negeren
  }
  detail = detail.replace(/\s+/g, " ").trim().slice(0, 240);

  let hint = "";
  if (res.status === 401 || res.status === 403) hint = " Controleer de API-sleutel.";
  else if (res.status === 404) hint = " Controleer de modelnaam.";
  else if (res.status === 429) hint = " Limiet bereikt; probeer het later opnieuw.";

  return new ProviderError(
    `${provider} gaf status ${res.status}${detail ? `: ${detail}` : ""}.${hint}`,
    res.status === 429 ? 429 : 502
  );
}
