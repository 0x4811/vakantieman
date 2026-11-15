// Ingebouwde wereldkaart (Natural Earth 110m, via world-atlas) als terugval wanneer kaarttegels niet laden.

import { feature } from "topojson-client";
import type { FeatureCollection } from "geojson";
import countries from "world-atlas/countries-110m.json";

let cached: FeatureCollection | null = null;

export function landGeoJson(): FeatureCollection {
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topo = countries as any;
    cached = feature(topo, topo.objects.countries) as unknown as FeatureCollection;
  }
  return cached;
}
