// Ingebouwde wereldkaart (Natural Earth 110m, via world-atlas) als terugval wanneer kaarttegels niet laden.
// Een paar vlakken (Rusland, Fiji, Antarctica) lopen over de datumgrens; die worden hier doorgeknipt,
// anders trekt de kaartrenderer er brede vlakken dwars over de wereld van.

import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Polygon, Position } from "geojson";
import countries from "world-atlas/countries-110m.json";

type Ring = Position[];

/** Maakt de lengtegraden doorlopend (geen sprongen van 180 naar -180) en sluit poolringen af. */
function unwrap(ring: Ring): Ring {
  const out: Ring = [];
  let offset = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    if (i > 0) {
      const prev = ring[i - 1][0];
      if (lon - prev > 180) offset -= 360;
      else if (prev - lon > 180) offset += 360;
    }
    out.push([lon + offset, lat]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  // Een ring die de pool omsluit eindigt 360 graden verderop: sluit hem via de pool.
  if (Math.abs(last[0] - first[0]) > 180) {
    const pole = ring.reduce((sum, p) => sum + p[1], 0) / ring.length < 0 ? -90 : 90;
    out.push([last[0], pole], [first[0], pole]);
  }
  out.push([first[0], first[1]]);
  return out;
}

/** Sutherland-Hodgman tegen één verticale lijn. */
function clipSide(ring: Ring, x: number, keepGreater: boolean): Ring {
  const inside = (p: Position): boolean => (keepGreater ? p[0] >= x : p[0] <= x);
  const out: Ring = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (x - a[0]) / (b[0] - a[0]);
      out.push([x, a[1] + t * (b[1] - a[1])]);
    }
  }
  if (out.length > 0) out.push(out[0]);
  return out;
}

function clipWindow(ring: Ring, min: number, max: number): Ring {
  const right = clipSide(ring, min, true);
  return right.length ? clipSide(right, max, false) : right;
}

function splitRing(ring: Ring): Ring[] {
  const flat = unwrap(ring);
  const xs = flat.map((p) => p[0]);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (lo >= -180 && hi <= 180) return [flat];
  const pieces: Ring[] = [];
  for (const shift of [-720, -360, 0, 360, 720]) {
    const piece = clipWindow(flat, -180 + shift, 180 + shift);
    if (piece.length >= 4) pieces.push(piece.map(([x, y]) => [x - shift, y]));
  }
  return pieces;
}

let cached: FeatureCollection | null = null;

export function landGeoJson(): FeatureCollection {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = countries as any;
  const source = feature(topo, topo.objects.countries) as unknown as FeatureCollection;
  const features: Feature<Polygon>[] = [];
  for (const f of source.features) {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    for (const rings of polygons) {
      const [outer, ...holes] = rings;
      const pieces = splitRing(outer);
      for (const piece of pieces) {
        // Gaten blijven alleen behouden bij vlakken die niet over de datumgrens lopen.
        const keep = pieces.length === 1 ? holes : [];
        features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [piece, ...keep] } });
      }
    }
  }
  cached = { type: "FeatureCollection", features };
  return cached;
}
