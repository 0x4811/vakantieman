import { describe, expect, it } from "vitest";
import { inspectJpeg } from "../src/worker/jpeg";
import { makeJpeg } from "./helpers";

describe("inspectJpeg", () => {
  it("accepteert een schone JPEG en leest de afmetingen", () => {
    expect(inspectJpeg(makeJpeg({ width: 1234, height: 987 }))).toEqual({ ok: true, width: 1234, height: 987 });
  });

  it("weigert EXIF/XMP-metadata", () => {
    const r = inspectJpeg(makeJpeg({ exif: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/metadata/i);
  });

  it("weigert een multi-picture-extensie", () => {
    expect(inspectJpeg(makeJpeg({ mpf: true })).ok).toBe(false);
  });

  it("weigert extra data achter de JPEG", () => {
    expect(inspectJpeg(makeJpeg({ trailing: 200 })).ok).toBe(false);
  });

  it("weigert bestanden die geen JPEG zijn", () => {
    expect(inspectJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ok).toBe(false);
    expect(inspectJpeg(new Uint8Array([])).ok).toBe(false);
  });

  it("weigert afgekapte bestanden", () => {
    const full = makeJpeg();
    expect(inspectJpeg(full.slice(0, 20)).ok).toBe(false);
  });
});

import { sanitizeJpeg } from "../src/shared/jpeg-clean";

describe("sanitizeJpeg", () => {
  it("laat een schone JPEG ongewijzigd door", () => {
    const clean = makeJpeg();
    expect(Array.from(sanitizeJpeg(clean))).toEqual(Array.from(clean));
  });

  it("verwijdert EXIF en multi-picture-segmenten zodat de server-controle slaagt", () => {
    const dirty = makeJpeg({ exif: true, mpf: true, width: 321, height: 123 });
    expect(inspectJpeg(dirty).ok).toBe(false);
    const cleaned = sanitizeJpeg(dirty);
    expect(inspectJpeg(cleaned)).toEqual({ ok: true, width: 321, height: 123 });
  });

  it("haalt data na het laatste EOI weg", () => {
    const withTail = new Uint8Array([...makeJpeg(), 0xff, 0xd8, 0x00, 0x01]);
    const cleaned = sanitizeJpeg(withTail);
    // Alleen als de staart binnen 16 bytes valt wordt hij afgesneden; hier is dat het geval.
    expect(inspectJpeg(cleaned).ok).toBe(true);
  });
});
