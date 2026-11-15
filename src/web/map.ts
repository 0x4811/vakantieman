// Kaartlaag voor alle schermen: MapLibre met OpenFreeMap-tegels en een ingebouwde wereldkaart als terugval.
// Onzekerheidsgebieden, stemmen en verbindingslijnen zijn GeoJSON-lagen; pins en labels zijn HTML-markers,
// zodat alles ook zonder lettertypes van een tegelserver werkt.

import { LngLatBounds, Map as MlMap, Marker, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import type { Feature, FeatureCollection } from "geojson";
import { circlePolygon } from "../shared/geo";
import { landGeoJson } from "./land";
import type { AreaItem, LinkItem, MapView, PinItem } from "./map-types";

export { COLORS } from "./map-types";
export type { AreaItem, LinkItem, MapView, PinItem, PinKind } from "./map-types";

const ONLINE_STYLE = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_AFTER_MS = 6000;

export interface DemoMapOptions {
  center?: [number, number]; // [lon, lat]
  zoom?: number;
  interactive?: boolean;
  /** Direct de ingebouwde wereldkaart gebruiken (offline-speler). */
  forceOffline?: boolean;
  onClick?: (lat: number, lon: number) => void;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function offlineStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { land: { type: "geojson", data: landGeoJson() } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#cfe3f1" } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": "#f3f1ea" } },
      { id: "land-line", type: "line", source: "land", paint: { "line-color": "#b4ae9e", "line-width": 0.7 } }
    ]
  };
}

export class DemoMap implements MapView {
  readonly map: MlMap;
  private ready: Promise<void>;
  private pins = new Map<string, Marker>();
  private linkLabels = new Map<string, Marker>();
  private areas: AreaItem[] = [];
  private votes: [number, number][] = [];
  private links: LinkItem[] = [];
  private styleLoaded = false;
  private offline = false;

  constructor(container: HTMLElement, options: DemoMapOptions = {}) {
    this.offline = Boolean(options.forceOffline);
    this.map = new MlMap({
      container,
      style: this.offline ? offlineStyle() : ONLINE_STYLE,
      center: options.center ?? [8, 48],
      zoom: options.zoom ?? 3,
      interactive: options.interactive ?? true,
      attributionControl: { compact: true }
    });

    this.ready = new Promise<void>((resolve) => {
      this.map.on("style.load", () => {
        this.styleLoaded = true;
        this.installLayers();
        this.push();
        resolve();
      });
    });

    if (options.onClick) {
      this.map.getCanvas().style.cursor = "crosshair";
      this.map.on("click", (e) => options.onClick?.(e.lngLat.lat, e.lngLat.lng));
    }

    if (!this.offline) {
      // Geen netwerk of tegelserver onbereikbaar: val terug op de ingebouwde wereldkaart.
      const timer = setTimeout(() => this.useFallback(), FALLBACK_AFTER_MS);
      this.map.once("style.load", () => clearTimeout(timer));
      this.map.on("error", () => {
        if (!this.styleLoaded) setTimeout(() => this.useFallback(), 800);
      });
    }
  }

  private useFallback(): void {
    if (this.styleLoaded || this.offline) return;
    this.offline = true;
    this.map.setStyle(offlineStyle());
  }

  /** Is de kaart op de ingebouwde terugval overgeschakeld? */
  get usingFallback(): boolean {
    return this.offline;
  }

  private installLayers(): void {
    const m = this.map;
    if (!m.getSource("areas")) {
      m.addSource("areas", { type: "geojson", data: EMPTY });
      m.addLayer({
        id: "area-fill",
        type: "fill",
        source: "areas",
        paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "opacity"] }
      });
      m.addLayer({
        id: "area-line",
        type: "line",
        source: "areas",
        paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": ["min", 1, ["+", ["get", "opacity"], 0.4]] }
      });
    }
    if (!m.getSource("links")) {
      m.addSource("links", { type: "geojson", data: EMPTY });
      m.addLayer({
        id: "link-line",
        type: "line",
        source: "links",
        paint: { "line-color": ["get", "color"], "line-width": 3, "line-dasharray": [2, 1.5] }
      });
    }
    if (!m.getSource("votes")) {
      m.addSource("votes", { type: "geojson", data: EMPTY });
      m.addLayer({
        id: "vote-dots",
        type: "circle",
        source: "votes",
        paint: {
          "circle-radius": 6,
          "circle-color": "#4aa8ff",
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5
        }
      });
    }
  }

  private push(): void {
    if (!this.styleLoaded) return;
    const areaFeatures: Feature[] = this.areas.map((a) => ({
      type: "Feature",
      properties: { color: a.color, opacity: a.opacity },
      geometry: { type: "Polygon", coordinates: [circlePolygon(a.lat, a.lon, a.radius_km)] }
    }));
    (this.map.getSource("areas") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: areaFeatures });

    (this.map.getSource("votes") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: this.votes.map(([lon, lat]) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } }))
    });

    (this.map.getSource("links") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: this.links.map((l) => ({
        type: "Feature",
        properties: { color: l.color },
        geometry: { type: "LineString", coordinates: [l.from, l.to] }
      }))
    });
  }

  async whenReady(): Promise<void> {
    await this.ready;
  }

  setAreas(items: AreaItem[]): void {
    this.areas = items;
    this.push();
  }

  setVotes(points: [number, number][]): void {
    this.votes = points;
    this.push();
  }

  addVotes(points: [number, number][]): void {
    this.votes = this.votes.concat(points);
    this.push();
  }

  setLinks(items: LinkItem[]): void {
    this.links = items;
    this.push();
    const keep = new Set(items.map((l) => l.id));
    for (const [id, marker] of this.linkLabels) {
      if (!keep.has(id)) {
        marker.remove();
        this.linkLabels.delete(id);
      }
    }
    for (const l of items) {
      const mid: [number, number] = [(l.from[0] + l.to[0]) / 2, (l.from[1] + l.to[1]) / 2];
      const existing = this.linkLabels.get(l.id);
      if (existing) {
        existing.setLngLat(mid);
        existing.getElement().textContent = l.label;
      } else {
        const el = document.createElement("div");
        el.className = "link-label";
        el.textContent = l.label;
        this.linkLabels.set(l.id, new Marker({ element: el }).setLngLat(mid).addTo(this.map));
      }
    }
  }

  setPins(items: PinItem[]): void {
    const keep = new Set(items.map((p) => p.id));
    for (const [id, marker] of this.pins) {
      if (!keep.has(id)) {
        marker.remove();
        this.pins.delete(id);
      }
    }
    for (const p of items) {
      const existing = this.pins.get(p.id);
      if (existing) {
        existing.setLngLat([p.lon, p.lat]);
        continue;
      }
      const el = document.createElement("div");
      el.className = `pin pin--${p.kind}`;
      if (p.label) {
        const span = document.createElement("span");
        span.textContent = p.label;
        el.append(span);
      }
      this.pins.set(p.id, new Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(this.map));
    }
  }

  fit(points: [number, number][], options: { padding?: number; maxZoom?: number; duration?: number } = {}): void {
    if (points.length === 0) return;
    const duration = options.duration ?? 900;
    if (points.length === 1) {
      this.map.easeTo({ center: points[0], zoom: options.maxZoom ?? 8, duration });
      return;
    }
    const bounds = new LngLatBounds(points[0], points[0]);
    for (const p of points) bounds.extend(p);
    this.map.fitBounds(bounds, { padding: options.padding ?? 60, maxZoom: options.maxZoom ?? 14, duration });
  }

  /** Past de kaart op een verzameling gebieden (cirkels), inclusief hun straal. */
  fitAreas(areas: { lat: number; lon: number; radius_km: number }[], options: { padding?: number; maxZoom?: number; duration?: number } = {}): void {
    const pts: [number, number][] = [];
    for (const a of areas) {
      const dLat = a.radius_km / 111;
      const dLon = a.radius_km / (111 * Math.max(0.2, Math.cos((a.lat * Math.PI) / 180)));
      pts.push([a.lon - dLon, a.lat - dLat], [a.lon + dLon, a.lat + dLat]);
    }
    this.fit(pts, options);
  }

  resize(): void {
    this.map.resize();
  }

  remove(): void {
    for (const m of this.pins.values()) m.remove();
    for (const m of this.linkLabels.values()) m.remove();
    this.pins.clear();
    this.linkLabels.clear();
    this.map.remove();
  }
}

