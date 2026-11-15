// Gedeelde types voor Worker, browser en bench-script.

export const REVEAL_LEVELS = ["country", "city", "district", "street"] as const;
export type RevealLevel = (typeof REVEAL_LEVELS)[number];

export const REVEAL_LEVEL_LABELS: Record<RevealLevel, string> = {
  country: "Land",
  city: "Stad",
  district: "Wijk",
  street: "Straat"
};

export const SENSITIVITIES = ["public", "private"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export type Variant = "original" | "masked";

export const PROVIDER_IDS = ["claude", "gemini", "workers-ai", "mock"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const CLUE_CATEGORIES = [
  "bebording",
  "architectuur",
  "begroeiing",
  "terrein",
  "infrastructuur",
  "voertuigen",
  "taal",
  "zon_schaduw",
  "kaart_of_scherm",
  "orientatiepunt",
  "overig"
] as const;
export type ClueCategory = (typeof CLUE_CATEGORIES)[number];

export const CLUE_CATEGORY_LABELS: Record<ClueCategory, string> = {
  bebording: "Bebording",
  architectuur: "Architectuur",
  begroeiing: "Begroeiing",
  terrein: "Terrein en uitzicht",
  infrastructuur: "Infrastructuur",
  voertuigen: "Voertuigen",
  taal: "Taal en tekst",
  zon_schaduw: "Zon en schaduw",
  kaart_of_scherm: "Kaart of scherm",
  orientatiepunt: "Oriëntatiepunt",
  overig: "Overig"
};

/** Kader op de foto, genormaliseerd 0..1 als [x1, y1, x2, y2] (oorsprong linksboven). */
export type Box = [number, number, number, number];

export interface Clue {
  id: string;
  category: ClueCategory;
  description: string;
  box: Box | null;
  confidence: number;
  leak_advice: string;
  /** Door de beheerder verborgen: wordt niet getoond in de presentatie. */
  hidden?: boolean;
}

export interface Candidate {
  id: string;
  country: string;
  city: string;
  district: string;
  street: string;
  lat: number;
  lon: number;
  radius_km: number;
  confidence: number;
  reasoning: string;
  supporting_clue_ids: string[];
  hidden?: boolean;
}

export interface Analysis {
  summary: string;
  overall_confidence: number;
  clues: Clue[];
  candidates: Candidate[];
}

export interface PhotoDto {
  id: string;
  label: string;
  width: number;
  height: number;
  reveal_level: RevealLevel;
  sensitivity: Sensitivity;
  has_masked: boolean;
  /** Plaatsnaam zoals het publiek die mag zien. */
  true_place: string;
  true_lat: number;
  true_lon: number;
  created_at: string;
}

export interface AnalysisDto {
  id: string;
  photo_id: string;
  variant: Variant;
  provider: string;
  model: string;
  approved: boolean;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  result: Analysis;
}

export interface SessionSummary {
  votes: number;
  median_km: number | null;
  closest_km: number | null;
  tool_km: number | null;
  masked_tool_km: number | null;
  ended_at: string;
}

export interface SessionDto {
  id: string;
  code: string;
  photo_id: string;
  analysis_id: string;
  masked_analysis_id: string | null;
  state: "created" | "live" | "ended";
  started_at: string | null;
  ended_at: string | null;
  summary: SessionSummary | null;
  created_at: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  default_model: string;
  available: boolean;
  /** Mag dit foto's met gevoeligheid "private" ontvangen? */
  allowed_for_private: boolean;
  note: string;
}

export interface ConfigDto {
  user: string;
  providers: ProviderInfo[];
  default_provider: ProviderId;
  default_model: string;
}
