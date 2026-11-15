// Presentatiescherm: één weergave voor alle fasen. De live presentatie (WebSocket) en de
// offline-speler gebruiken exact dezelfde code; alleen de bron van toestand en stemmen verschilt.

import { formatKm } from "../shared/geo";
import { placeLabel } from "../shared/levels";
import {
  analysisView,
  lessonClues,
  PHASE_LABELS,
  type RevealResults,
  type ScriptAnalysis,
  type SessionScript,
  type SessionState
} from "../shared/session";
import { CLUE_CATEGORY_LABELS, type Candidate } from "../shared/types";
import { h, mount } from "./dom";
import { COLORS, type AreaItem, type LinkItem, type MapView, type PinItem } from "./map-types";
import { photoStage, type PhotoStage } from "./photo-view";
import { qrDataUrl } from "./qr";

export interface StageOptions {
  photoSrc: (variant: "original" | "masked") => string;
  /** Maakt de kaart (MapLibre online, SVG offline). */
  createMap: (container: HTMLElement) => MapView;
  /** Offline-speler: geen live stemmen. */
  offline?: boolean;
}

const label = (c: Candidate): string => placeLabel(c) || "onbekend";
const percent = (v: number): string => `${Math.round(v * 100)}%`;

export class Stage {
  private script: SessionScript;
  private state: SessionState;
  private votes: [number, number][] = [];
  private voteCount = 0;
  private results: RevealResults | null = null;

  private root: HTMLElement;
  private map!: MapView;
  private original!: PhotoStage;
  private masked: PhotoStage | null = null;

  private el = {
    stage: h("div", { class: "stage" }),
    intro: h("div", { class: "stage-intro" }),
    main: h("div", { class: "stage-main" }),
    left: h("div", { class: "stage-left" }),
    photos: h("div", { class: "stage-photos" }),
    caption: h("div", { class: "stage-caption" }),
    right: h("div", { class: "stage-right" }),
    mapBox: h("div", { class: "stage-map" }),
    side: h("div", { class: "stage-side" }),
    badge: h("div", { class: "stage-badge" }),
    blank: h("div", { class: "stage-blank hidden" }),
    code: h("div", { class: "stage-code mono" })
  };
  private qr: { url: string | null; src: string } = { url: null, src: "" };
  private fittedFor = "";

  constructor(
    root: HTMLElement,
    script: SessionScript,
    state: SessionState,
    private options: StageOptions
  ) {
    this.root = root;
    this.script = script;
    this.state = state;
    this.build();
    this.render();
  }

  // ------------------------------------------------------------ opbouw

  private build(): void {
    const e = this.el;
    this.original = photoStage(this.options.photoSrc("original"), this.script.analysis.clues, {
      label: (_clue, index) => String(index + 1)
    });
    this.masked = this.script.masked ? photoStage(this.options.photoSrc("masked"), [], {}) : null;
    e.photos.append(this.original.el);
    if (this.masked) {
      this.masked.el.classList.add("hidden");
      e.photos.append(this.masked.el);
    }
    e.left.append(e.photos, e.caption);
    e.right.append(e.mapBox, e.side);
    e.main.append(e.left, e.right);
    e.stage.append(e.intro, e.main, e.badge, e.code, e.blank);
    mount(this.root, e.stage);

    this.map = this.options.createMap(e.mapBox);
    e.code.textContent = this.script.code;
  }

  destroy(): void {
    this.map.remove();
  }

  // ------------------------------------------------------------ invoer

  setScript(script: SessionScript): void {
    this.script = script;
    this.root.replaceChildren();
    this.map.remove();
    this.el.photos.replaceChildren();
    this.el.left.replaceChildren();
    this.el.right.replaceChildren();
    this.el.main.replaceChildren();
    this.el.stage.replaceChildren();
    this.fittedFor = "";
    this.build();
    this.render();
  }

  update(state: SessionState, results: RevealResults | null): void {
    this.state = state;
    this.results = results;
    this.render();
  }

  setVotes(points: [number, number][], count: number): void {
    this.votes = points;
    this.voteCount = count;
    this.map.setVotes(points);
    if (this.state.phase === "guessing") this.renderGuessingSide();
  }

  resize(): void {
    this.map.resize();
  }

  // ------------------------------------------------------------ weergave

  private render(): void {
    const { phase } = this.state;
    const e = this.el;
    e.blank.classList.toggle("hidden", !this.state.blank);
    e.stage.dataset.phase = phase;

    const intro = phase === "idle" || phase === "done";
    e.intro.classList.toggle("hidden", !intro);
    e.main.classList.toggle("hidden", intro);
    e.badge.textContent = intro ? "" : PHASE_LABELS[phase];
    e.code.classList.toggle("hidden", phase === "idle" || phase === "done");

    if (phase === "idle") return this.renderIdle();
    if (phase === "done") return this.renderDone();

    const showMasked = phase === "masked" && this.masked !== null;
    this.original.el.classList.toggle("hidden", showMasked);
    this.masked?.el.classList.toggle("hidden", !showMasked);

    this.map.setAreas([]);
    this.map.setLinks([]);
    this.map.setPins([]);
    this.map.setVotes(phase === "guessing" || phase === "reveal" ? this.votes : []);
    mount(e.caption);
    mount(e.side);

    switch (phase) {
      case "guessing":
        return this.renderGuessing();
      case "analysis":
        return this.renderAnalysis();
      case "reveal":
        return this.renderReveal();
      case "lesson":
        return this.renderLesson();
      case "masked":
        return this.renderMasked();
    }
  }

  private fit(key: string, run: () => void): void {
    if (this.fittedFor === key) return;
    this.fittedFor = key;
    run();
  }

  private renderIdle(): void {
    mount(
      this.el.intro,
      h("div", { class: "intro-card" }, [
        h("p", { class: "eyebrow" }, "Een demonstratie"),
        h("h1", null, "Waar is Wouter?"),
        h("p", { class: "lead" }, "Eén selfie. Kunt u raden waar hij staat, en wat kan een computer er in een paar seconden uit halen?")
      ])
    );
  }

  private renderDone(): void {
    const r = this.results;
    mount(
      this.el.intro,
      h("div", { class: "intro-card" }, [
        h("p", { class: "eyebrow" }, "Wat u mee naar huis neemt"),
        h("h1", null, "Een foto zegt meer dan u denkt"),
        h("ul", { class: "takeaways" }, [
          h("li", null, "Details die u zelf niet opmerkt, zijn voor een computer aanwijzingen."),
          h("li", null, "Kijk voor het plaatsen van een foto wat er op te zien is, ook op de achtergrond."),
          h("li", null, "Verwijder of verberg wat verraadt waar u bent, voordat u deelt.")
        ]),
        r
          ? h(
              "p",
              { class: "muted" },
              `Vandaag: ${r.votes} gokken, mediaan ${formatKm(r.median_km)} ernaast. De tool zat er ${formatKm(r.tool_km)} naast.`
            )
          : null
      ])
    );
  }

  private renderGuessing(): void {
    this.original.show("none");
    mount(
      this.el.caption,
      h("div", { class: "caption" }, [
        h("h2", null, "Waar is Wouter?"),
        h("p", { class: "muted" }, "Scan de code, tik op de kaart en dien uw gok in.")
      ])
    );
    this.fit("guessing", () => this.map.fit([[10, 30]], { maxZoom: 1.4, duration: 0 }));
    this.renderGuessingSide();
  }

  private renderGuessingSide(): void {
    if (this.options.offline) {
      mount(
        this.el.side,
        h("div", { class: "vote-card vote-card--offline" }, [
          h("div", { class: "vote-info" }, [
            h("div", { class: "vote-open" }, "Raadronde"),
            h("p", { class: "lead-small" }, "Geen internet nodig: laat het publiek hardop raden of met handopsteken.")
          ])
        ])
      );
      return;
    }
    const url = this.script.vote_url;
    const qrImg = h("img", { class: "qr", alt: "QR-code om mee te doen", width: 220, height: 220 });
    if (url) {
      if (this.qr.url === url && this.qr.src) qrImg.src = this.qr.src;
      else
        void qrDataUrl(url, 440).then((src) => {
          this.qr = { url, src };
          qrImg.src = src;
        });
    }
    mount(
      this.el.side,
      h("div", { class: "vote-card" }, [
        url ? qrImg : h("div", { class: "qr qr--none" }, "Geen stem-URL ingesteld"),
        h("div", { class: "vote-info" }, [
          h("div", { class: "vote-open" }, this.state.votesOpen ? "Raadronde open" : "Raadronde gesloten"),
          url ? h("div", { class: "vote-url mono" }, url.replace(/^https?:\/\//, "")) : null,
          h("div", { class: "vote-count" }, [h("b", null, this.voteCount), this.voteCount === 1 ? " gok" : " gokken"])
        ])
      ])
    );
  }

  private renderAnalysis(): void {
    const a = this.script.analysis;
    const view = analysisView(a, this.state.step, label);
    const visible = new Set(view.revealedClueIds);
    this.original.show(visible, view.focusClueId);

    const areas: AreaItem[] = view.areas.map((area) => ({
      id: area.id,
      lat: area.lat,
      lon: area.lon,
      radius_km: area.radius_km,
      color: area.primary ? COLORS.top : COLORS.other,
      opacity: 0.12 + 0.3 * area.strength
    }));
    this.map.setAreas(areas);
    const pins: PinItem[] = view.areas
      .filter((area) => area.strength >= 0.5)
      .map((area) => ({ id: area.id, lat: area.lat, lon: area.lon, label: area.place, kind: "candidate" as const }));
    this.map.setPins(pins);

    this.fit(`analysis:${this.state.step}`, () => {
      if (view.areas.length === 0) this.map.fit([[10, 30]], { maxZoom: 1.4, duration: 600 });
      else this.map.fitAreas(view.areas, { padding: 80, maxZoom: 15, duration: 1200 });
    });

    const clue = a.clues.find((c) => c.id === view.focusClueId);
    const total = a.clues.length;
    mount(
      this.el.caption,
      clue
        ? h("div", { class: "caption" }, [
            h("p", { class: "eyebrow" }, `Aanwijzing ${this.state.step} van ${total} · ${CLUE_CATEGORY_LABELS[clue.category]}`),
            h("h2", null, clue.description),
            h("p", { class: "muted" }, `Zekerheid van de tool: ${percent(clue.confidence)}`)
          ])
        : h("div", { class: "caption" }, [
            h("p", { class: "eyebrow" }, "De tool kijkt mee"),
            h("h2", null, "Wat ziet een computer in deze foto?")
          ])
    );

    const leading = view.areas.find((x) => x.primary) ?? view.areas[0];
    mount(
      this.el.side,
      h("div", { class: "guess-card" }, [
        h("p", { class: "eyebrow" }, "Beste gok van de tool"),
        leading
          ? h("div", { class: "guess-place" }, leading.place)
          : h("div", { class: "guess-place muted" }, "Nog geen idee"),
        leading ? h("div", { class: "meter" }, h("span", { style: { width: percent(leading.confidence * leading.strength) } })) : null,
        leading ? h("p", { class: "muted small" }, `Zekerheid ${percent(leading.confidence * leading.strength)} · marge ${formatKm(leading.radius_km)}`) : null,
        view.complete ? h("p", { class: "small" }, a.summary) : null
      ])
    );
  }

  private renderReveal(): void {
    const t = this.script.photo.truth;
    const r = this.results;
    this.original.show("none");
    const pins: PinItem[] = [{ id: "truth", lat: t.lat, lon: t.lon, label: `Echt: ${t.place}`, kind: "truth" }];
    const links: LinkItem[] = [];
    const bounds: [number, number][] = [[t.lon, t.lat]];

    if (r?.tool_point) {
      pins.push({ id: "tool", lat: r.tool_point[1], lon: r.tool_point[0], label: "De tool", kind: "tool" });
      links.push({ id: "l-tool", from: [t.lon, t.lat], to: r.tool_point, label: formatKm(r.tool_km), color: COLORS.top });
      bounds.push(r.tool_point);
    }
    if (r?.closest_point) {
      pins.push({ id: "closest", lat: r.closest_point[1], lon: r.closest_point[0], label: "Beste gok publiek", kind: "audience" });
      links.push({ id: "l-closest", from: [t.lon, t.lat], to: r.closest_point, label: formatKm(r.closest_km), color: COLORS.audience });
      bounds.push(r.closest_point);
    }
    this.map.setPins(pins);
    this.map.setLinks(links);
    // Het hele publiek komt in beeld, zodat de verspreiding van de gokken te zien is.
    const all = bounds.concat(this.votes.slice(0, 600));
    this.fit(`reveal:${bounds.length}:${r?.votes ?? 0}`, () => this.map.fit(all, { padding: 110, maxZoom: 11, duration: 1400 }));

    mount(
      this.el.caption,
      h("div", { class: "caption" }, [
        h("p", { class: "eyebrow" }, "De onthulling"),
        h("h2", null, `Wouter stond in ${t.place}`)
      ])
    );

    mount(
      this.el.side,
      h("div", { class: "score-card" }, [
        h("div", { class: "score-row" }, [
          h("div", { class: "score score--audience" }, [
            h("span", null, "Het publiek, mediaan"),
            h("b", null, r && r.votes > 0 ? formatKm(r.median_km) : "geen gokken"),
            h("small", null, `${r?.votes ?? 0} gokken`)
          ]),
          h("div", { class: "score score--tool" }, [
            h("span", null, "De tool"),
            h("b", null, formatKm(r?.tool_km)),
            h("small", null, `${this.script.analysis.provider}`)
          ])
        ]),
        r && r.votes > 0 ? this.bucketBars(r) : null
      ])
    );
  }

  private bucketBars(r: RevealResults): HTMLElement {
    const max = Math.max(1, ...r.buckets.map((b) => b.count));
    return h(
      "div",
      { class: "buckets" },
      r.buckets.map((b) =>
        h("div", { class: "bucket" }, [
          h("span", null, b.label),
          h("div", { class: "bar" }, h("i", { style: { width: `${(b.count / max) * 100}%` } })),
          h("b", null, b.count)
        ])
      )
    );
  }

  private renderLesson(): void {
    const items = lessonClues(this.script);
    const step = this.state.step;
    const clue = step > 0 ? items[step - 1] : null;
    const visible = new Set(items.slice(0, step).map((c) => c.id));
    this.original.show(visible, clue?.id ?? null);
    this.map.setAreas([]);

    if (!clue) {
      mount(
        this.el.caption,
        h("div", { class: "caption" }, [
          h("p", { class: "eyebrow" }, "De les"),
          h("h2", null, `${items.length} dingen die verraden waar u bent`),
          h("p", { class: "muted" }, "Zo voorkomt u het.")
        ])
      );
      mount(
        this.el.side,
        h(
          "div",
          { class: "lesson-card" },
          h(
            "ol",
            { class: "lesson-list" },
            items.map((c) => h("li", null, c.description))
          )
        )
      );
      return;
    }
    mount(
      this.el.caption,
      h("div", { class: "caption" }, [
        h("p", { class: "eyebrow" }, `Les ${step} van ${items.length} · ${CLUE_CATEGORY_LABELS[clue.category]}`),
        h("h2", null, clue.description)
      ])
    );
    mount(
      this.el.side,
      h("div", { class: "lesson-card lesson-card--tip" }, [
        h("p", { class: "eyebrow" }, "Zo voorkomt u het"),
        h("p", { class: "tip" }, clue.leak_advice)
      ])
    );
  }

  private renderMasked(): void {
    const t = this.script.photo.truth;
    const m = this.script.masked;
    const step = this.state.step;
    const r = this.results;
    if (!m) return;

    if (step === 0) {
      mount(
        this.el.caption,
        h("div", { class: "caption" }, [
          h("p", { class: "eyebrow" }, "Onzichtbaar maken"),
          h("h2", null, "Dezelfde foto, zonder de verraders"),
          h("p", { class: "muted" }, "Wat weet de tool er nu nog uit te halen?")
        ])
      );
      this.fit("masked:0", () => this.map.fit([[10, 30]], { maxZoom: 1.4, duration: 600 }));
      return;
    }

    const view = analysisView(m, m.clues.length, label);
    this.map.setAreas(
      view.areas.map((a) => ({
        id: a.id,
        lat: a.lat,
        lon: a.lon,
        radius_km: a.radius_km,
        color: COLORS.other,
        opacity: 0.2
      }))
    );
    const pins: PinItem[] = [{ id: "truth", lat: t.lat, lon: t.lon, label: `Echt: ${t.place}`, kind: "truth" }];
    if (r?.tool_point) pins.push({ id: "tool", lat: r.tool_point[1], lon: r.tool_point[0], label: "Eerste gok", kind: "tool" });
    this.map.setPins(pins);
    this.fit("masked:1", () => this.map.fitAreas([{ lat: t.lat, lon: t.lon, radius_km: 50 }, ...view.areas], { padding: 100, maxZoom: 10, duration: 1200 }));

    mount(
      this.el.caption,
      h("div", { class: "caption" }, [
        h("p", { class: "eyebrow" }, "Na het verbergen"),
        h("h2", null, m.overall_confidence < this.script.analysis.overall_confidence ? "De tool is veel minder zeker" : "De tool weet nog steeds veel")
      ])
    );
    mount(
      this.el.side,
      h("div", { class: "score-card" }, [
        h("div", { class: "score-row" }, [
          h("div", { class: "score score--tool" }, [
            h("span", null, "Zekerheid voor"),
            h("b", null, percent(this.script.analysis.overall_confidence)),
            h("small", null, `${formatKm(r?.tool_km)} ernaast`)
          ]),
          h("div", { class: "score score--audience" }, [
            h("span", null, "Zekerheid na"),
            h("b", null, percent(m.overall_confidence)),
            h("small", null, `${formatKm(r?.masked_tool_km)} ernaast`)
          ])
        ]),
        h("p", { class: "small" }, (m as ScriptAnalysis).summary)
      ])
    );
  }
}
