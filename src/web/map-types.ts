// Gemeenschappelijke vormen voor kaartweergaven: de MapLibre-kaart (online) en de eenvoudige SVG-kaart (offline-speler).

export interface AreaItem {
  id: string;
  lat: number;
  lon: number;
  radius_km: number;
  color: string;
  opacity: number;
}

export type PinKind = "truth" | "tool" | "audience" | "candidate" | "pick";

export interface PinItem {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  kind: PinKind;
}

export interface LinkItem {
  id: string;
  from: [number, number]; // [lon, lat]
  to: [number, number];
  label: string;
  color: string;
}

/** Wat het presentatiescherm van een kaart nodig heeft. */
export interface MapView {
  setAreas(items: AreaItem[]): void;
  setVotes(points: [number, number][]): void;
  setLinks(items: LinkItem[]): void;
  setPins(items: PinItem[]): void;
  fit(points: [number, number][], options?: { padding?: number; maxZoom?: number; duration?: number }): void;
  fitAreas(areas: { lat: number; lon: number; radius_km: number }[], options?: { padding?: number; maxZoom?: number; duration?: number }): void;
  resize(): void;
  remove(): void;
}

export const COLORS = {
  top: "#ff5a5f",
  other: "#ffc845",
  truth: "#3dd68c",
  audience: "#4aa8ff"
};
