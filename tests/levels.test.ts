import { describe, expect, it } from "vitest";
import { applyRevealLevel, placeLabel, publicPoint } from "../src/shared/levels";
import { sampleAnalysis } from "./helpers";

describe("detailniveau", () => {
  it("laat op landniveau alleen het land staan en haalt namen uit de tekst", () => {
    const out = applyRevealLevel(sampleAnalysis(), "country");
    const c = out.candidates[0];
    expect(c.country).toBe("België");
    expect(c.city).toBe("");
    expect(c.district).toBe("");
    expect(c.street).toBe("");
    const alles = JSON.stringify(out);
    expect(alles).not.toMatch(/Antwerpen/i);
    expect(alles).not.toMatch(/Leopold/i);
    expect(alles).not.toMatch(/Zuid/i);
    expect(alles).toContain("België");
  });

  it("rondt coördinaten af en geeft een ondergrens voor de straal", () => {
    const country = applyRevealLevel(sampleAnalysis(), "country").candidates[0];
    expect(country.lat).toBe(51);
    expect(country.lon).toBe(4);
    expect(country.radius_km).toBeGreaterThanOrEqual(150);

    const city = applyRevealLevel(sampleAnalysis(), "city").candidates[0];
    expect(city.lat).toBe(51.2);
    expect(city.lon).toBe(4.4);
    expect(city.city).toBe("Antwerpen");
    expect(city.district).toBe("");
    expect(city.radius_km).toBeGreaterThanOrEqual(10);

    const district = applyRevealLevel(sampleAnalysis(), "district").candidates[0];
    expect(district.district).toBe("Zuid");
    expect(district.street).toBe("");
    expect(JSON.stringify(district)).not.toMatch(/Leopold/i);

    const street = applyRevealLevel(sampleAnalysis(), "street").candidates[0];
    expect(street.street).toBe("Leopold De Waelplaats");
    expect(street.lat).toBe(51.2125);
    expect(street.radius_km).toBe(0.2);
  });

  it("is idempotent", () => {
    const once = applyRevealLevel(sampleAnalysis(), "city");
    expect(applyRevealLevel(once, "city")).toEqual(once);
  });

  it("redigeert een naam niet als die ook op een toegestaan niveau staat", () => {
    const a = sampleAnalysis();
    a.candidates[0] = { ...a.candidates[0], country: "Singapore", city: "Singapore", district: "", street: "" };
    a.summary = "Foto in Singapore.";
    const out = applyRevealLevel(a, "country");
    expect(out.summary).toContain("Singapore");
  });

  it("bouwt een plaatsnaam en een publiek punt", () => {
    expect(placeLabel({ country: "België", city: "Antwerpen", district: "", street: "" })).toBe("Antwerpen, België");
    expect(publicPoint(51.21254, 4.39521, "city")).toEqual({ lat: 51.2, lon: 4.4, radius_km: 10 });
  });
});
