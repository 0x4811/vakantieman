// Haalt metadata-segmenten uit een JPEG (alles behalve JFIF, ICC en Adobe), zonder het beeld te hercoderen.
// Wordt in de browser gebruikt als laatste stap vóór het uploaden, voor het geval een browser
// toch iets extra's in het canvas-resultaat schrijft. De Worker controleert daarna streng.

const KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

export function sanitizeJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let pos = 2;

  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return bytes;
    while (pos < bytes.length && bytes[pos + 1] === 0xff) pos++;
    const marker = bytes[pos + 1];
    const start = pos;
    pos += 2;

    if (marker === 0xda) {
      // Begin van de beelddata: de rest ongewijzigd overnemen.
      chunks.push(bytes.subarray(start));
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.subarray(start, pos));
      continue;
    }
    if (marker === 0xd9) {
      chunks.push(bytes.subarray(start, pos));
      break;
    }

    if (pos + 2 > bytes.length) return bytes;
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2 || pos + length > bytes.length) return bytes;
    const end = pos + length;

    const isApp = marker >= 0xe0 && marker <= 0xef;
    const drop = (isApp && !KEEP_APP.has(marker)) || marker === 0xfe;
    let dropIt = drop;
    // Multi-picture-extensie (APP2 met "MPF") ook verwijderen.
    if (!dropIt && marker === 0xe2 && length >= 8) {
      const sig = String.fromCharCode(bytes[pos + 2], bytes[pos + 3], bytes[pos + 4]);
      if (sig === "MPF") dropIt = true;
    }
    if (!dropIt) chunks.push(bytes.subarray(start, end));
    pos = end;
  }

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }

  // Alles na het laatste EOI weghalen (bijvoorbeeld een ingebed tweede beeld).
  for (let i = out.length - 2; i >= Math.max(0, out.length - 16); i--) {
    if (out[i] === 0xff && out[i + 1] === 0xd9) return out.subarray(0, i + 2);
  }
  return out;
}
