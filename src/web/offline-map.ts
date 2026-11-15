// Eenvoudige kaart zonder MapLibre en zonder netwerk: SVG met de ingebouwde wereldkaart (Mercator).
// Alleen voor de offline-speler; houdt het bestand klein en werkt vanuit een los HTML-bestand.

import { circlePolygon } from "../shared/geo";
import { landGeoJson } from "./land";
import { COLORS, type AreaItem, type LinkItem, type MapView, type PinItem } from "./map-types";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_LAT = 84;

/** Lengte in graden, breedte als Mercator-y in graden (zodat een cirkel rond blijft). */
function project(lon: number, lat: number): [number, number] {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return [lon, (Math.log(Math.tan(Math.PI / 4 + phi / 2)) * 180) / Math.PI];
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

interface View {
  cx: number;
  cy: number;
  /** Breedte van het zichtbare gebied in graden. */
  w: number;
}

export class OfflineMap implements MapView {
  private root = document.createElement("div");
  private svg = svg("svg", { class: "omap-svg", preserveAspectRatio: "xMidYMid slice" });
  private layer = svg("g");
  private votesLayer = svg("g");
  private areasLayer = svg("g");
  private linksLayer = svg("g");
  private pinsLayer = document.createElement("div");
  private view: View = { cx: 10, cy: project(0, 30)[1], w: 160 };
  private target: View = { ...this.view };
  private frame = 0;
  private areas: AreaItem[] = [];
  private votes: [number, number][] = [];
  private links: LinkItem[] = [];
  private pins: PinItem[] = [];

  constructor(private container: HTMLElement) {
    this.root.className = "omap";
    this.pinsLayer.className = "omap-pins";
    const land = svg("path", { class: "omap-land", fill: "#f3f1ea", stroke: "#b4ae9e", "stroke-width": 0.7, "vector-effect": "non-scaling-stroke" });
    land.setAttribute("d", this.landPath());
    this.layer.append(land, this.areasLayer, this.linksLayer, this.votesLayer);
    this.svg.append(this.layer);
    this.root.append(this.svg, this.pinsLayer);
    container.append(this.root);
    this.root.style.background = "#cfe3f1";
    new ResizeObserver(() => this.render()).observe(container);
    this.render();
  }

  private landPath(): string {
    let d = "";
    for (const f of landGeoJson().features) {
      if (f.geometry.type !== "Polygon") continue;
      for (const ring of f.geometry.coordinates) {
        ring.forEach(([lon, lat], i) => {
          const [x, y] = project(lon, lat);
          d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${(-y).toFixed(2)}`;
        });
        d += "Z";
      }
    }
    return d;
  }

  // ------------------------------------------------------------ weergave

  private size(): { w: number; h: number } {
    return { w: Math.max(1, this.container.clientWidth), h: Math.max(1, this.container.clientHeight) };
  }

  private render(): void {
    const { w, h } = this.size();
    const vw = this.view.w;
    const vh = (vw * h) / w;
    const x = this.view.cx - vw / 2;
    const y = -this.view.cy - vh / 2;
    this.svg.setAttribute("viewBox", `${x} ${y} ${vw} ${vh}`);
    const px = vw / w; // graden per beeldpunt
    this.votesLayer.replaceChildren(
      ...this.votes.map(([lon, lat]) => {
        const [mx, my] = project(lon, lat);
        return svg("circle", { cx: mx, cy: -my, r: 5 * px, fill: "#4aa8ff", stroke: "#fff", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", opacity: 0.85 });
      })
    );
    const toScreen = (lon: number, lat: number): [number, number] => {
      const [mx, my] = project(lon, lat);
      return [((mx - x) / vw) * w, ((-my - y) / vh) * h];
    };
    this.pinsLayer.replaceChildren(
      ...this.pins.map((p) => {
        const [sx, sy] = toScreen(p.lon, p.lat);
        const el = document.createElement("div");
        el.className = `pin pin--${p.kind}`;
        el.style.cssText = `position:absolute;left:${sx}px;top:${sy}px`;
        if (p.label) {
          const span = document.createElement("span");
          span.textContent = p.label;
          el.append(span);
        }
        return el;
      }),
      ...this.links.map((l) => {
        const [mx, my] = toScreen((l.from[0] + l.to[0]) / 2, (l.from[1] + l.to[1]) / 2);
        const el = document.createElement("div");
        el.className = "link-label";
        el.style.cssText = `position:absolute;left:${mx}px;top:${my}px;transform:translate(-50%,-50%)`;
        el.textContent = l.label;
        return el;
      })
    );
    this.areasLayer.replaceChildren(
      ...this.areas.map((a) => {
        const ring = circlePolygon(a.lat, a.lon, a.radius_km, 72);
        const path = svg("path", {
          d: ring.map(([lon, lat], i) => `${i === 0 ? "M" : "L"}${project(lon, lat)[0]} ${-project(lon, lat)[1]}`).join("") + "Z",
          fill: a.color,
          "fill-opacity": a.opacity,
          stroke: a.color,
          "stroke-width": 2,
          "vector-effect": "non-scaling-stroke"
        });
        return path;
      })
    );
    this.linksLayer.replaceChildren(
      ...this.links.map((l) => {
        const [x1, y1] = project(l.from[0], l.from[1]);
        const [x2, y2] = project(l.to[0], l.to[1]);
        return svg("line", { x1, y1: -y1, x2, y2: -y2, stroke: l.color, "stroke-width": 3, "stroke-dasharray": "8 6", "vector-effect": "non-scaling-stroke" });
      })
    );
  }

  private animateTo(target: View, duration: number): void {
    cancelAnimationFrame(this.frame);
    this.target = target;
    if (duration <= 0) {
      this.view = { ...target };
      this.render();
      return;
    }
    const from = { ...this.view };
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.view = { cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, w: from.w * (target.w / from.w) ** e };
      this.render();
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ MapView

  setAreas(items: AreaItem[]): void {
    this.areas = items;
    this.render();
  }
  setVotes(points: [number, number][]): void {
    this.votes = points;
    this.render();
  }
  setLinks(items: LinkItem[]): void {
    this.links = items;
    this.render();
  }
  setPins(items: PinItem[]): void {
    this.pins = items;
    this.render();
  }

  fit(points: [number, number][], options: { padding?: number; maxZoom?: number; duration?: number } = {}): void {
    if (points.length === 0) return;
    const projected = points.map(([lon, lat]) => project(lon, lat));
    const xs = projected.map((p) => p[0]);
    const ys = projected.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const { w, h } = this.size();
    const pad = options.padding ?? 60;
    // Een enkel punt krijgt een vaste, ruime beeldbreedte (graden).
    const spanX = Math.max(maxX - minX, 0.0001);
    const spanY = Math.max(maxY - minY, 0.0001);
    const byX = (spanX * w) / Math.max(1, w - 2 * pad);
    const byY = (spanY * w) / Math.max(1, h - 2 * pad);
    const minWidth = points.length === 1 ? 6 : 0.5;
    this.animateTo({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: Math.min(360, Math.max(minWidth, byX, byY)) }, options.duration ?? 900);
  }

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
    this.render();
  }

  remove(): void {
    cancelAnimationFrame(this.frame);
    this.root.remove();
  }
}

export { COLORS };
