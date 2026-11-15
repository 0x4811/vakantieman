// Kleine geo-hulpfuncties. Geen afhankelijkheden, draait overal.

const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Grootcirkelafstand in kilometers (haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function isValidLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** Afstand netjes in het Nederlands: "850 m", "12 km", "1.234 km". */
export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return "onbekend";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km).toLocaleString("nl-NL")} km`;
}

/** Cirkel als GeoJSON-polygoon (voor onzekerheidsgebieden op de kaart). */
export function circlePolygon(
  lat: number,
  lon: number,
  radiusKm: number,
  steps = 64
): [number, number][] {
  const coords: [number, number][] = [];
  const latRad = toRad(lat);
  const angDist = radiusKm / EARTH_RADIUS_KM;
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angDist) + Math.cos(latRad) * Math.sin(angDist) * Math.cos(bearing)
    );
    const lon2 =
      toRad(lon) +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angDist) * Math.cos(latRad),
        Math.cos(angDist) - Math.sin(latRad) * Math.sin(lat2)
      );
    coords.push([((lon2 * 180) / Math.PI + 540) % 360 - 180, (lat2 * 180) / Math.PI]);
  }
  return coords;
}

/** Past een afbeelding in de limieten van het beeldmodel (lange zijde en aantal visuele tokens). */
export function fitForVision(
  width: number,
  height: number,
  maxEdge = 2576,
  maxTokens = 4784
): { width: number; height: number } {
  let scale = Math.min(1, maxEdge / Math.max(width, height));
  let w = Math.max(1, Math.round(width * scale));
  let h = Math.max(1, Math.round(height * scale));
  while (Math.ceil(w / 28) * Math.ceil(h / 28) > maxTokens) {
    scale *= 0.98;
    w = Math.max(1, Math.round(width * scale));
    h = Math.max(1, Math.round(height * scale));
  }
  return { width: w, height: h };
}
