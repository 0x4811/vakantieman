import { describe, expect, it } from "vitest";
import { circlePolygon, fitForVision, formatKm, haversineKm, isValidLatLon, median } from "../src/shared/geo";

describe("geo", () => {
  it("berekent afstanden (Amsterdam-Parijs is ongeveer 430 km)", () => {
    const km = haversineKm(52.3676, 4.9041, 48.8566, 2.3522);
    expect(km).toBeGreaterThan(425);
    expect(km).toBeLessThan(435);
    expect(haversineKm(10, 10, 10, 10)).toBe(0);
  });

  it("berekent de mediaan", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([1, 9, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("valideert coördinaten", () => {
    expect(isValidLatLon(51, 4)).toBe(true);
    expect(isValidLatLon(91, 4)).toBe(false);
    expect(isValidLatLon(0, 181)).toBe(false);
    expect(isValidLatLon(Number.NaN, 0)).toBe(false);
  });

  it("formatteert afstanden in het Nederlands", () => {
    expect(formatKm(0.85)).toBe("850 m");
    expect(formatKm(4.25)).toBe("4,3 km");
    expect(formatKm(12.4)).toBe("12 km");
    expect(formatKm(null)).toBe("onbekend");
  });

  it("maakt een gesloten cirkel op de juiste afstand", () => {
    const ring = circlePolygon(51.5, 4.5, 10, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const [lon, lat] of ring) {
      expect(haversineKm(51.5, 4.5, lat, lon)).toBeCloseTo(10, 1);
    }
  });

  it("past afbeeldingen in de limieten van het model", () => {
    const a = fitForVision(4032, 3024);
    expect(Math.max(a.width, a.height)).toBeLessThanOrEqual(2576);
    expect(Math.ceil(a.width / 28) * Math.ceil(a.height / 28)).toBeLessThanOrEqual(4784);
    // Kleine afbeeldingen blijven ongemoeid.
    expect(fitForVision(800, 600)).toEqual({ width: 800, height: 600 });
    // Bekend voorbeeld uit de documentatie: 3840x2160 -> 2576x1449.
    expect(fitForVision(3840, 2160)).toEqual({ width: 2576, height: 1449 });
  });
});
