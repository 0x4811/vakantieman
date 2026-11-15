// Controle van geüploade JPEG's: geen metadata (EXIF, GPS, XMP, IPTC), geen extra data.
// De browser codeert elke foto opnieuw via een canvas, waardoor dit vanzelf klopt;
// dit is de controle aan de serverkant. Leest alleen de segmentkoppen: verwaarloosbare CPU-tijd.

export type JpegCheck =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: string };

// Toegestane APP-segmenten: JFIF (E0), ICC-profiel (E2) en Adobe-kleurinfo (EE).
const ALLOWED_APP = new Set([0xe0, 0xe2, 0xee]);
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function inspectJpeg(bytes: Uint8Array): JpegCheck {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { ok: false, reason: "Dit is geen JPEG-bestand." };
  }

  let pos = 2;
  let width = 0;
  let height = 0;

  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return { ok: false, reason: "Beschadigde JPEG-structuur." };
    // Opvulbytes (0xFF) overslaan.
    while (pos < bytes.length && bytes[pos + 1] === 0xff) pos++;
    const marker = bytes[pos + 1];
    pos += 2;

    // Markers zonder lengte.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;

    if (pos + 2 > bytes.length) return { ok: false, reason: "Afgekapte JPEG." };
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) return { ok: false, reason: "Afgekapte JPEG." };

    if (marker >= 0xe0 && marker <= 0xef) {
      if (!ALLOWED_APP.has(marker)) {
        const kind = marker === 0xe1 ? "EXIF/XMP" : "APP" + (marker - 0xe0);
        return { ok: false, reason: `De foto bevat metadata (${kind}). Codeer de foto opnieuw in de browser.` };
      }
      // Multi-picture-extensie (iPhone, extra beeld erachter): niet toegestaan.
      if (marker === 0xe2 && length >= 8) {
        const sig = String.fromCharCode(bytes[pos + 2], bytes[pos + 3], bytes[pos + 4]);
        if (sig === "MPF") return { ok: false, reason: "De foto bevat een multi-picture-extensie." };
      }
    } else if (marker === 0xfe) {
      return { ok: false, reason: "De foto bevat een commentaarsegment." };
    } else if (SOF_MARKERS.has(marker)) {
      if (length < 8) return { ok: false, reason: "Beschadigde JPEG-structuur." };
      height = (bytes[pos + 3] << 8) | bytes[pos + 4];
      width = (bytes[pos + 5] << 8) | bytes[pos + 6];
    } else if (marker === 0xda) {
      // Begin van de beelddata: de koppen zijn gecontroleerd.
      break;
    }
    pos += length;
  }

  if (width === 0 || height === 0) return { ok: false, reason: "Geen afmetingen gevonden in de JPEG." };

  // Het bestand moet eindigen op EOI (FFD9); extra data erachter is niet toegestaan.
  let end = -1;
  for (let i = bytes.length - 2; i >= Math.max(0, bytes.length - 16); i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      end = i + 2;
      break;
    }
  }
  if (end === -1) return { ok: false, reason: "De JPEG eindigt niet netjes." };
  if (end !== bytes.length) return { ok: false, reason: "Er staat extra data achter de JPEG." };

  return { ok: true, width, height };
}
