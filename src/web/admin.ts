// Beheer: foto's uploaden, analyseren, beoordelen en goedkeuren voor de presentatie.

import "./style.css";
import { api, photoUrl } from "./api";
import { $, formatDateTime, h, mount, openModal, toast } from "./dom";
import { blobToBase64, prepareImage, type PreparedImage } from "./image-tools";
import { COLORS, DemoMap } from "./map";
import { photoStage } from "./photo-view";
import { renderSessions } from "./sessions-view";
import { formatKm } from "../shared/geo";
import { placeLabel } from "../shared/levels";
import {
  CLUE_CATEGORY_LABELS,
  REVEAL_LEVELS,
  REVEAL_LEVEL_LABELS,
  type AnalysisDto,
  type Candidate,
  type Clue,
  type ConfigDto,
  type PhotoDto,
  type RevealLevel,
  type Sensitivity,
  type Variant
} from "../shared/types";

const root = $("#app");

const state = {
  config: null as ConfigDto | null,
  photos: [] as PhotoDto[],
  selectedId: null as string | null,
  analyses: [] as AnalysisDto[],
  analysisId: null as string | null,
  focusClue: null as string | null,
  running: false,
  view: "photos" as "photos" | "sessions"
};

let analysisMap: DemoMap | null = null;

const LEVEL_HELP: Record<RevealLevel, string> = {
  country: "Alleen het land. Geschikt voor foto's van thuis.",
  city: "Tot en met de stad; coördinaten worden afgerond op ongeveer 10 km.",
  district: "Tot en met de wijk; coördinaten worden afgerond op ongeveer 1 km.",
  street: "Volledig detail, tot op de straat."
};

const selectedPhoto = (): PhotoDto | null => state.photos.find((p) => p.id === state.selectedId) ?? null;
const currentAnalysis = (): AnalysisDto | null => state.analyses.find((a) => a.id === state.analysisId) ?? null;
const pct = (n: number): string => `${Math.round(n * 100)}%`;

function destroyMap(): void {
  analysisMap?.remove();
  analysisMap = null;
}

// ---------------------------------------------------------------- opbouw

function renderShell(): void {
  mount(
    root,
    h(
      "header",
      { class: "topbar" },
      h("div", { class: "brand" }, h("i"), "vakantieman"),
      h("span", { class: "muted small" }, "Awareness-demo · alleen eigen selfies"),
      h("button", { class: `tab${state.view === "photos" ? " is-active" : ""}`, onclick: () => setView("photos") }, "Foto's"),
      h("button", { class: `tab${state.view === "sessions" ? " is-active" : ""}`, onclick: () => setView("sessions") }, "Sessies"),
      h("span", { class: "grow" }),
      h("span", { class: "chip", title: "Ingelogd als" }, state.config?.user ?? "")
    ),
    h("div", { class: "layout" }, h("aside", { class: "sidebar", id: "sidebar" }), h("main", { class: "main", id: "main" }))
  );
  renderSidebar();
  renderMain();
}

function renderSidebar(): void {
  const sidebar = $("#sidebar");
  mount(
    sidebar,
    h("button", { class: "btn btn--primary", onclick: () => openUploadModal() }, "+ Nieuwe foto"),
    state.photos.length === 0
      ? h("div", { class: "empty small" }, "Nog geen foto's. Upload een selfie met een bekende locatie.")
      : h(
          "div",
          { class: "list" },
          state.photos.map((photo) =>
            h(
              "button",
              { class: `photo-item${photo.id === state.selectedId ? " is-active" : ""}`, onclick: () => void selectPhoto(photo.id) },
              h("img", { src: photoUrl(photo.id), alt: "", loading: "lazy" }),
              h(
                "div",
                { style: { minWidth: "0" } },
                h("b", null, photo.label),
                h("span", { class: "muted small" }, photo.true_place),
                h("div", { class: "row", style: { gap: "4px", marginTop: "4px" } }, h("span", { class: "chip" }, REVEAL_LEVEL_LABELS[photo.reveal_level]), photo.sensitivity === "private" ? h("span", { class: "chip chip--warn" }, "privé") : null)
              )
            )
          )
        ),
    h("p", { class: "muted small" }, "Foto's worden in je browser verkleind en zonder EXIF/GPS opnieuw gecodeerd voordat ze worden geüpload.")
  );
}

function setView(view: "photos" | "sessions"): void {
  state.view = view;
  renderShell();
}

function renderMain(): void {
  destroyMap();
  const main = $("#main");
  if (state.view === "sessions") {
    void renderSessions(main, state.photos);
    return;
  }
  const photo = selectedPhoto();
  if (!photo) {
    mount(main, h("div", { class: "empty" }, "Kies links een foto of upload een nieuwe."));
    return;
  }
  mount(main, photoHeader(photo), analysisSection(photo));
  mountAnalysisMap();
}

function photoHeader(photo: PhotoDto): HTMLElement {
  return h(
    "div",
    { class: "row row--between" },
    h(
      "div",
      { class: "stack", style: { gap: "6px" } },
      h("h1", { style: { fontSize: "22px" } }, photo.label),
      h(
        "div",
        { class: "row" },
        h("span", { class: "chip chip--ok" }, `Publiek: ${photo.true_place}`),
        h("span", { class: "chip" }, `Detailniveau: ${REVEAL_LEVEL_LABELS[photo.reveal_level]}`),
        h("span", { class: photo.sensitivity === "private" ? "chip chip--warn" : "chip" }, photo.sensitivity === "private" ? "Privé" : "Publiek"),
        h("span", { class: "chip" }, `${photo.width} × ${photo.height}`)
      )
    ),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn", onclick: () => openEditModal(photo) }, "Bewerken"),
      h("button", { class: "btn btn--danger", onclick: () => void deletePhoto(photo) }, "Verwijderen")
    )
  );
}

function analysisSection(photo: PhotoDto): HTMLElement {
  const analysis = currentAnalysis();
  const clues = analysis?.result.clues ?? [];
  const visible = new Set(clues.filter((c) => !c.hidden).map((c) => c.id));

  const stage = photoStage(photoUrl(photo.id, analysis?.variant ?? "original"), clues, {
    onSelect: (id) => focusClue(id),
    label: (clue) => String(clues.indexOf(clue) + 1)
  });
  stage.show(visible, state.focusClue);

  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "two-col" },
      h("div", { class: "stack" }, stage.el, h("p", { class: "muted small" }, "De kaders komen van het model en kunnen kleine afwijkingen hebben. Controleer ze voordat je een analyse goedkeurt.")),
      h("div", { class: "stack" }, controlsCard(photo), analysis ? resultCard(photo, analysis) : h("div", { class: "empty" }, "Nog geen analyse. Kies een provider en start er een."))
    ),
    analysis ? h("div", { class: "stack" }, h("h3", null, "Kandidaatgebieden"), h("div", { class: "map-box map-box--tall", id: "analysis-map" })) : null
  );
}

function controlsCard(photo: PhotoDto): HTMLElement {
  const config = state.config;
  const providers = config?.providers ?? [];
  const usable = (id: string): boolean => {
    const p = providers.find((x) => x.id === id);
    return Boolean(p && p.available && (photo.sensitivity === "public" || p.allowed_for_private));
  };

  const providerSelect = h(
    "select",
    { "aria-label": "Provider" },
    providers.map((p) => {
      let note = "";
      if (!p.available) note = ` (niet beschikbaar: ${p.note})`;
      else if (photo.sensitivity === "private" && !p.allowed_for_private) note = " (niet toegestaan voor privéfoto's)";
      return h("option", { value: p.id, disabled: !usable(p.id) }, p.label + note);
    })
  );
  const preferred = config && usable(config.default_provider) ? config.default_provider : providers.find((p) => usable(p.id))?.id;
  if (preferred) providerSelect.value = preferred;

  const modelInput = h("input", { type: "text", placeholder: "Standaardmodel van de provider", "aria-label": "Model" });
  const updatePlaceholder = (): void => {
    const p = providers.find((x) => x.id === providerSelect.value);
    modelInput.placeholder = p ? p.default_model : "";
  };
  providerSelect.addEventListener("change", updatePlaceholder);
  updatePlaceholder();

  const variantSelect = h(
    "select",
    { "aria-label": "Variant" },
    h("option", { value: "original" }, "Originele foto"),
    h("option", { value: "masked", disabled: !photo.has_masked }, photo.has_masked ? "Bewerkte foto (afgedekt)" : "Bewerkte foto (nog niet gemaakt)")
  );

  const select = h(
    "select",
    { "aria-label": "Eerdere analyses", onchange: (e: Event) => {
      state.analysisId = (e.target as HTMLSelectElement).value;
      state.focusClue = null;
      renderMain();
    } },
    state.analyses.map((a) => h("option", { value: a.id }, `${a.provider} · ${a.model} · ${a.variant === "masked" ? "bewerkt" : "origineel"} · ${formatDateTime(a.created_at)}${a.approved ? " ✓" : ""}`))
  );
  if (state.analysisId) select.value = state.analysisId;

  return h(
    "div",
    { class: "card stack" },
    h("h3", null, "Analyse starten"),
    h("div", { class: "two-col", style: { gap: "10px" } }, h("label", { class: "field" }, "Provider", providerSelect), h("label", { class: "field" }, "Model", modelInput)),
    h("label", { class: "field" }, "Foto", variantSelect),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          class: "btn btn--primary",
          disabled: state.running || !preferred,
          onclick: () => void runAnalysis(photo, providerSelect.value, modelInput.value.trim(), variantSelect.value as Variant)
        },
        state.running ? [h("span", { class: "spinner" }), "Bezig met analyseren…"] : "Analyseer"
      ),
      photo.sensitivity === "private" ? h("span", { class: "muted small" }, "Privéfoto: alleen providers met een toelatingsregel.") : null
    ),
    state.analyses.length > 0 ? h("label", { class: "field" }, "Eerdere analyses", select) : null
  );
}

function resultCard(photo: PhotoDto, analysis: AnalysisDto): HTMLElement {
  const result = analysis.result;
  const hiddenClues = new Set(result.clues.filter((c) => c.hidden).map((c) => c.id));
  const hiddenCands = new Set(result.candidates.filter((c) => c.hidden).map((c) => c.id));

  const patch = (body: object) => patchAnalysis(analysis, body);

  const moveClue = (index: number, delta: number): void => {
    const order = result.clues.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void patch({ clue_order: order });
  };

  const clueItem = (clue: Clue, index: number): HTMLElement =>
    h(
      "div",
      { class: `item${clue.hidden ? " is-hidden" : ""}${state.focusClue === clue.id ? " is-focus" : ""}`, onclick: () => focusClue(clue.id) },
      h(
        "div",
        { class: "row row--between" },
        h("div", { class: "row" }, h("span", { class: "num" }, String(index + 1)), h("span", { class: "chip" }, CLUE_CATEGORY_LABELS[clue.category]), h("span", { class: "muted small" }, `zekerheid ${pct(clue.confidence)}`), clue.box ? null : h("span", { class: "chip" }, "geen kader")),
        h(
          "div",
          { class: "row", style: { gap: "4px" } },
          h("button", { class: "btn btn--small btn--ghost", title: "Eerder tonen", "aria-label": "Eerder tonen", onclick: (e: Event) => { e.stopPropagation(); moveClue(index, -1); } }, "↑"),
          h("button", { class: "btn btn--small btn--ghost", title: "Later tonen", "aria-label": "Later tonen", onclick: (e: Event) => { e.stopPropagation(); moveClue(index, 1); } }, "↓")
        )
      ),
      h("p", null, clue.description),
      clue.leak_advice ? h("p", { class: "muted small" }, `Tip: ${clue.leak_advice}`) : null,
      h(
        "label",
        { class: "check small", onclick: (e: Event) => e.stopPropagation() },
        h("input", {
          type: "checkbox",
          checked: Boolean(clue.hidden),
          onchange: (e: Event) => {
            const next = new Set(hiddenClues);
            if ((e.target as HTMLInputElement).checked) next.add(clue.id);
            else next.delete(clue.id);
            void patch({ hidden_clue_ids: [...next] });
          }
        }),
        "Verberg in de presentatie"
      )
    );

  const candidateItem = (cand: Candidate, index: number): HTMLElement =>
    h(
      "div",
      { class: `item${cand.hidden ? " is-hidden" : ""}`, onclick: () => analysisMap?.fitAreas([cand], { maxZoom: 12 }) },
      h("div", { class: "row row--between" }, h("b", null, `${index + 1}. ${placeLabel(cand) || "Onbekende plek"}`), h("span", { class: "chip" }, `${pct(cand.confidence)} · ± ${formatKm(cand.radius_km)}`)),
      h("div", { class: "bar" }, h("span", { style: { width: pct(cand.confidence) } })),
      cand.reasoning ? h("p", { class: "muted small" }, cand.reasoning) : null,
      h(
        "label",
        { class: "check small", onclick: (e: Event) => e.stopPropagation() },
        h("input", {
          type: "checkbox",
          checked: Boolean(cand.hidden),
          onchange: (e: Event) => {
            const next = new Set(hiddenCands);
            if ((e.target as HTMLInputElement).checked) next.add(cand.id);
            else next.delete(cand.id);
            void patch({ hidden_candidate_ids: [...next] });
          }
        }),
        "Verberg in de presentatie"
      )
    );

  return h(
    "div",
    { class: "card stack" },
    h(
      "div",
      { class: "row row--between" },
      h("h3", null, "Resultaat"),
      h(
        "label",
        { class: "check" },
        h("input", { type: "checkbox", checked: analysis.approved, onchange: (e: Event) => void patch({ approved: (e.target as HTMLInputElement).checked }) }),
        h("span", { class: analysis.approved ? "chip chip--ok" : "chip" }, analysis.approved ? "Goedgekeurd voor presentatie" : "Nog niet goedgekeurd")
      )
    ),
    h(
      "div",
      { class: "row" },
      h("span", { class: "chip" }, `${analysis.provider} · ${analysis.model}`),
      analysis.variant === "masked" ? h("span", { class: "chip chip--warn" }, "bewerkte foto") : null,
      analysis.latency_ms !== null ? h("span", { class: "chip" }, `${(analysis.latency_ms / 1000).toFixed(1)} s`) : null,
      analysis.input_tokens ? h("span", { class: "chip" }, `${analysis.input_tokens} in / ${analysis.output_tokens ?? 0} uit`) : null,
      h("span", { class: "chip" }, `Algemene zekerheid ${pct(result.overall_confidence)}`)
    ),
    result.summary ? h("p", null, result.summary) : null,
    h("h4", null, `Aanwijzingen (${result.clues.length})`),
    result.clues.length === 0 ? h("p", { class: "muted small" }, "Het model vond geen aanwijzingen.") : h("div", { class: "list" }, result.clues.map(clueItem)),
    h("h4", null, `Kandidaten (${result.candidates.length})`),
    result.candidates.length === 0 ? h("p", { class: "muted small" }, "Het model durfde geen plek te noemen.") : h("div", { class: "list" }, result.candidates.map(candidateItem)),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn btn--danger btn--small", onclick: () => void deleteAnalysis(analysis) }, "Deze analyse verwijderen"),
      h("span", { class: "muted small" }, `Opgeslagen op detailniveau ${REVEAL_LEVEL_LABELS[photo.reveal_level].toLowerCase()}`)
    )
  );
}

function mountAnalysisMap(): void {
  const container = document.getElementById("analysis-map");
  const analysis = currentAnalysis();
  if (!container || !analysis) return;
  const map = new DemoMap(container, { center: [8, 48], zoom: 3 });
  analysisMap = map;
  const cands = analysis.result.candidates.filter((c) => !c.hidden);
  map.setAreas(
    cands.map((c, i) => ({
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      radius_km: c.radius_km,
      color: i === 0 ? COLORS.top : COLORS.other,
      opacity: 0.1 + 0.3 * c.confidence
    }))
  );
  map.setPins(cands.map((c, i) => ({ id: c.id, lat: c.lat, lon: c.lon, kind: i === 0 ? "tool" : "candidate", label: placeLabel(c) || undefined })));
  map.fitAreas(cands, { maxZoom: 12, duration: 0 });
}

function focusClue(id: string): void {
  state.focusClue = state.focusClue === id ? null : id;
  renderMain();
}

// ---------------------------------------------------------------- acties

async function selectPhoto(id: string | null): Promise<void> {
  state.selectedId = id;
  state.analyses = [];
  state.analysisId = null;
  state.focusClue = null;
  if (state.view !== "photos") {
    state.view = "photos";
    renderShell();
  } else {
    renderSidebar();
    renderMain();
  }
  if (id) await loadAnalyses(id);
}

async function loadAnalyses(photoId: string): Promise<void> {
  try {
    const list = await api<AnalysisDto[]>(`/api/photos/${photoId}/analyses`);
    if (state.selectedId !== photoId) return;
    state.analyses = list;
    const pick = list.find((a) => a.approved && a.variant === "original") ?? list.find((a) => a.variant === "original") ?? list[0];
    state.analysisId = pick?.id ?? null;
    renderMain();
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

async function runAnalysis(photo: PhotoDto, provider: string, model: string, variant: Variant): Promise<void> {
  state.running = true;
  renderMain();
  try {
    const res = await fetch(photoUrl(photo.id, variant));
    if (!res.ok) throw new Error("De foto kon niet worden opgehaald.");
    const base64 = await blobToBase64(await res.blob());
    const params = new URLSearchParams({ provider, variant });
    if (model) params.set("model", model);
    const result = await api<AnalysisDto>(`/api/photos/${photo.id}/analyze?${params.toString()}`, {
      method: "POST",
      body: base64,
      headers: { "content-type": "text/plain" }
    });
    if (state.selectedId === photo.id) {
      state.analyses.unshift(result);
      state.analysisId = result.id;
      state.focusClue = null;
    }
    toast(`Analyse klaar: ${result.result.clues.length} aanwijzingen, ${result.result.candidates.length} kandidaten.`, "ok");
  } catch (error) {
    toast((error as Error).message, "error");
  } finally {
    state.running = false;
    renderMain();
  }
}

async function patchAnalysis(analysis: AnalysisDto, body: object): Promise<void> {
  try {
    const updated = await api<AnalysisDto>(`/api/analyses/${analysis.id}`, { method: "PATCH", json: body });
    state.analyses = state.analyses.map((a) => (a.id === updated.id ? updated : a));
    renderMain();
  } catch (error) {
    toast((error as Error).message, "error");
    renderMain();
  }
}

async function deleteAnalysis(analysis: AnalysisDto): Promise<void> {
  if (!confirm("Deze analyse verwijderen?")) return;
  try {
    await api(`/api/analyses/${analysis.id}`, { method: "DELETE" });
    state.analyses = state.analyses.filter((a) => a.id !== analysis.id);
    state.analysisId = state.analyses[0]?.id ?? null;
    renderMain();
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

async function deletePhoto(photo: PhotoDto): Promise<void> {
  if (!confirm(`"${photo.label}" verwijderen, inclusief alle analyses en sessies bij deze foto? Dit kan niet ongedaan worden gemaakt.`)) return;
  try {
    await api(`/api/photos/${photo.id}`, { method: "DELETE" });
    state.photos = state.photos.filter((p) => p.id !== photo.id);
    await selectPhoto(state.photos[0]?.id ?? null);
    toast("Foto verwijderd.", "ok");
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

// ---------------------------------------------------------------- formulieren

interface PhotoFields {
  label: HTMLInputElement;
  place: HTMLInputElement;
  lat: HTMLInputElement;
  lon: HTMLInputElement;
  level: HTMLSelectElement;
  sensitivity: HTMLSelectElement;
  levelHelp: HTMLElement;
  mapBox: HTMLElement;
  form: HTMLElement;
}

function buildPhotoFields(initial?: PhotoDto): PhotoFields {
  const label = h("input", { type: "text", placeholder: "Bijvoorbeeld: Terras in Antwerpen", value: initial?.label ?? "", maxLength: 80 });
  const place = h("input", { type: "text", placeholder: "Bijvoorbeeld: Antwerpen, België", value: initial?.true_place ?? "", maxLength: 120 });
  const lat = h("input", { type: "number", step: "any", placeholder: "Breedtegraad", value: initial ? String(initial.true_lat) : "" });
  const lon = h("input", { type: "number", step: "any", placeholder: "Lengtegraad", value: initial ? String(initial.true_lon) : "" });
  const level = h("select", null, REVEAL_LEVELS.map((l) => h("option", { value: l }, REVEAL_LEVEL_LABELS[l])));
  level.value = initial?.reveal_level ?? "city";
  const sensitivity = h(
    "select",
    null,
    h("option", { value: "private" }, "Privé: alleen naar providers die ik daarvoor heb toegestaan"),
    h("option", { value: "public" }, "Publiek: mag naar elke provider")
  );
  sensitivity.value = initial?.sensitivity ?? "private";
  const levelHelp = h("p", { class: "muted small" }, LEVEL_HELP[level.value as RevealLevel]);
  level.addEventListener("change", () => (levelHelp.textContent = LEVEL_HELP[level.value as RevealLevel]));
  const mapBox = h("div", { class: "map-box" });

  const form = h(
    "div",
    { class: "stack" },
    h("label", { class: "field" }, "Naam (alleen voor jou)", label),
    h("label", { class: "field" }, "Plaatsnaam zoals het publiek die mag zien", place),
    h("div", { class: "field" }, "Echte locatie: klik op de kaart of vul de coördinaten in", mapBox),
    h("div", { class: "two-col", style: { gap: "10px" } }, lat, lon),
    h("label", { class: "field" }, "Detailniveau van de onthulling", level, levelHelp),
    h("label", { class: "field" }, "Gevoeligheid", sensitivity)
  );
  return { label, place, lat, lon, level, sensitivity, levelHelp, mapBox, form };
}

function wirePickMap(fields: PhotoFields): () => void {
  let map: DemoMap | null = null;
  const refresh = (): void => {
    const la = Number(fields.lat.value);
    const lo = Number(fields.lon.value);
    if (fields.lat.value !== "" && fields.lon.value !== "" && Number.isFinite(la) && Number.isFinite(lo)) {
      map?.setPins([{ id: "pick", lat: la, lon: lo, kind: "pick" }]);
    }
  };
  requestAnimationFrame(() => {
    const la = Number(fields.lat.value);
    const lo = Number(fields.lon.value);
    const has = fields.lat.value !== "" && Number.isFinite(la) && Number.isFinite(lo);
    map = new DemoMap(fields.mapBox, {
      center: has ? [lo, la] : [8, 48],
      zoom: has ? 8 : 3,
      onClick: (lat, lon) => {
        fields.lat.value = lat.toFixed(5);
        fields.lon.value = lon.toFixed(5);
        refresh();
      }
    });
    refresh();
  });
  fields.lat.addEventListener("change", refresh);
  fields.lon.addEventListener("change", refresh);
  return () => map?.remove();
}

function openUploadModal(): void {
  const fields = buildPhotoFields();
  const file = h("input", { type: "file", accept: "image/*" });
  const preview = h("img", { class: "hidden", alt: "Voorbeeld", style: { maxWidth: "100%", maxHeight: "240px", borderRadius: "10px", border: "1px solid var(--line)" } });
  const info = h("p", { class: "muted small" }, "Kies een foto. Hij wordt in je browser verkleind en zonder EXIF/GPS opnieuw gecodeerd.");
  let prepared: PreparedImage | null = null;
  let busy = false;

  const submit = h("button", { class: "btn btn--primary", disabled: true }, "Uploaden");
  const cancel = h("button", { class: "btn btn--ghost", type: "button" }, "Annuleren");

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    info.textContent = "Bezig met voorbereiden…";
    submit.disabled = true;
    try {
      prepared = await prepareImage(f);
      preview.src = prepared.previewUrl;
      preview.classList.remove("hidden");
      info.textContent = `Klaar: ${prepared.width} × ${prepared.height} px, ${(prepared.blob.size / 1024).toFixed(0)} kB, zonder metadata.`;
      if (!fields.label.value) fields.label.value = f.name.replace(/\.[^.]+$/, "").slice(0, 80);
      submit.disabled = false;
    } catch (error) {
      prepared = null;
      info.textContent = (error as Error).message;
    }
  });

  const content = h("div", { class: "stack" }, h("h2", null, "Nieuwe foto"), h("label", { class: "field" }, "Foto", file), preview, info, fields.form, h("div", { class: "row", style: { justifyContent: "flex-end" } }, cancel, submit));
  let disposeMap = (): void => {};
  const close = openModal(content, () => {
    disposeMap();
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
  });
  disposeMap = wirePickMap(fields);
  cancel.addEventListener("click", close);

  submit.addEventListener("click", async () => {
    if (busy || !prepared) return;
    if (!fields.lat.value || !fields.lon.value) {
      toast("Kies de echte locatie op de kaart.", "error");
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = "Bezig met uploaden…";
    try {
      const params = new URLSearchParams({
        label: fields.label.value,
        place: fields.place.value,
        lat: fields.lat.value,
        lon: fields.lon.value,
        level: fields.level.value,
        sensitivity: fields.sensitivity.value
      });
      const photo = await api<PhotoDto>(`/api/photos?${params.toString()}`, { method: "POST", body: prepared.blob, headers: { "content-type": "image/jpeg" } });
      state.photos.unshift(photo);
      close();
      await selectPhoto(photo.id);
      toast("Foto geüpload.", "ok");
    } catch (error) {
      toast((error as Error).message, "error");
      busy = false;
      submit.disabled = false;
      submit.textContent = "Uploaden";
    }
  });
}

function openEditModal(photo: PhotoDto): void {
  const fields = buildPhotoFields(photo);
  const save = h("button", { class: "btn btn--primary" }, "Opslaan");
  const cancel = h("button", { class: "btn btn--ghost", type: "button" }, "Annuleren");
  const note = h("p", { class: "muted small" }, "Een grover detailniveau wordt meteen op bestaande analyses toegepast. Een fijner niveau kan details die al zijn weggehaald niet terugbrengen: maak daarvoor een nieuwe analyse.");
  let disposeMap = (): void => {};
  const close = openModal(h("div", { class: "stack" }, h("h2", null, "Foto bewerken"), fields.form, note, h("div", { class: "row", style: { justifyContent: "flex-end" } }, cancel, save)), () => disposeMap());
  disposeMap = wirePickMap(fields);
  cancel.addEventListener("click", close);
  save.addEventListener("click", async () => {
    try {
      const updated = await api<PhotoDto>(`/api/photos/${photo.id}`, {
        method: "PATCH",
        json: {
          label: fields.label.value,
          true_place: fields.place.value,
          true_lat: Number(fields.lat.value),
          true_lon: Number(fields.lon.value),
          reveal_level: fields.level.value,
          sensitivity: fields.sensitivity.value as Sensitivity
        }
      });
      state.photos = state.photos.map((p) => (p.id === updated.id ? updated : p));
      close();
      renderSidebar();
      await loadAnalyses(updated.id);
      toast("Opgeslagen.", "ok");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  });
}

// ---------------------------------------------------------------- start

async function boot(): Promise<void> {
  mount(root, h("div", { class: "empty", style: { margin: "40px auto", maxWidth: "420px" } }, h("span", { class: "spinner" }), " Laden…"));
  try {
    const [config, photos] = await Promise.all([api<ConfigDto>("/api/config"), api<PhotoDto[]>("/api/photos")]);
    state.config = config;
    state.photos = photos;
    renderShell();
    if (photos[0]) await selectPhoto(photos[0].id);
  } catch (error) {
    mount(root, h("div", { class: "empty", style: { margin: "40px auto", maxWidth: "520px" } }, (error as Error).message));
  }
}

void boot();
