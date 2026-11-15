// Hulpmiddelen voor tests.

import type { Analysis } from "../src/shared/types";

/** Bouwt een minimale, structureel geldige JPEG (alleen koppen, geen echte beelddata). */
export function makeJpeg(options: { width?: number; height?: number; exif?: boolean; mpf?: boolean; trailing?: number } = {}): Uint8Array {
  const { width = 640, height = 480 } = options;
  const out: number[] = [0xff, 0xd8];

  // JFIF (APP0)
  out.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);

  if (options.exif) {
    // APP1 met "Exif\0\0" en wat vulling
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00];
    out.push(0xff, 0xe1, 0x00, payload.length + 2, ...payload);
  }
  if (options.mpf) {
    const payload = [0x4d, 0x50, 0x46, 0x00, 0x00, 0x00];
    out.push(0xff, 0xe2, 0x00, payload.length + 2, ...payload);
  }

  // SOF0
  out.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  // SOS + wat "beelddata"
  out.push(0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0x56, 0x78);
  // EOI
  out.push(0xff, 0xd9);
  for (let i = 0; i < (options.trailing ?? 0); i++) out.push(0x00);
  return new Uint8Array(out);
}

export function sampleAnalysis(): Analysis {
  return {
    summary: "Gevel in Antwerpen aan de Leopold De Waelplaats, met uitzicht op Zuid.",
    overall_confidence: 0.7,
    clues: [
      {
        id: "c1",
        category: "taal",
        description: "Bord met de tekst Leopold De Waelplaats.",
        box: [0.1, 0.1, 0.4, 0.2],
        confidence: 0.8,
        leak_advice: "Houd straatborden buiten beeld (Leopold De Waelplaats)."
      },
      {
        id: "c2",
        category: "architectuur",
        description: "Gevel in de stijl van Antwerpen.",
        box: null,
        confidence: 0.5,
        leak_advice: "Kies een neutrale achtergrond."
      }
    ],
    candidates: [
      {
        id: "k1",
        country: "België",
        city: "Antwerpen",
        district: "Zuid",
        street: "Leopold De Waelplaats",
        lat: 51.21254,
        lon: 4.39521,
        radius_km: 0.2,
        confidence: 0.7,
        reasoning: "Het bord en de gevel wijzen op Antwerpen Zuid.",
        supporting_clue_ids: ["c1", "c2"]
      }
    ]
  };
}
