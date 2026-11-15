// Database-laag (D1): rijtypes, mapping naar DTO's en veelgebruikte queries.

import type {
  Analysis,
  AnalysisDto,
  PhotoDto,
  RevealLevel,
  Sensitivity,
  SessionDto,
  SessionSummary,
  Variant
} from "../shared/types";

export interface PhotoRow {
  id: string;
  label: string;
  r2_key: string;
  masked_r2_key: string | null;
  true_lat: number;
  true_lon: number;
  true_place: string;
  reveal_level: RevealLevel;
  sensitivity: Sensitivity;
  width: number;
  height: number;
  created_at: string;
}

export interface AnalysisRow {
  id: string;
  photo_id: string;
  variant: Variant;
  provider: string;
  model: string;
  result_json: string;
  approved: number;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  code: string;
  photo_id: string;
  analysis_id: string;
  masked_analysis_id: string | null;
  state: "created" | "live" | "ended";
  started_at: string | null;
  ended_at: string | null;
  summary_json: string | null;
  created_at: string;
}

export const nowIso = (): string => new Date().toISOString();

export function toPhotoDto(row: PhotoRow): PhotoDto {
  return {
    id: row.id,
    label: row.label,
    width: row.width,
    height: row.height,
    reveal_level: row.reveal_level,
    sensitivity: row.sensitivity,
    has_masked: row.masked_r2_key !== null,
    true_place: row.true_place,
    true_lat: row.true_lat,
    true_lon: row.true_lon,
    created_at: row.created_at
  };
}

export function toAnalysisDto(row: AnalysisRow): AnalysisDto {
  return {
    id: row.id,
    photo_id: row.photo_id,
    variant: row.variant,
    provider: row.provider,
    model: row.model,
    approved: row.approved === 1,
    latency_ms: row.latency_ms,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    created_at: row.created_at,
    result: JSON.parse(row.result_json) as Analysis
  };
}

export function toSessionDto(row: SessionRow): SessionDto {
  return {
    id: row.id,
    code: row.code,
    photo_id: row.photo_id,
    analysis_id: row.analysis_id,
    masked_analysis_id: row.masked_analysis_id,
    state: row.state,
    started_at: row.started_at,
    ended_at: row.ended_at,
    summary: row.summary_json ? (JSON.parse(row.summary_json) as SessionSummary) : null,
    created_at: row.created_at
  };
}

export const getPhoto = (db: D1Database, id: string) =>
  db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first<PhotoRow>();

export const getAnalysis = (db: D1Database, id: string) =>
  db.prepare("SELECT * FROM analyses WHERE id = ?").bind(id).first<AnalysisRow>();

export const getSession = (db: D1Database, id: string) =>
  db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();

export const getSessionByCode = (db: D1Database, code: string) =>
  db.prepare("SELECT * FROM sessions WHERE code = ?").bind(code).first<SessionRow>();

/** Geen dubbelzinnige tekens (0/O, 1/I/L) zodat de code voorgelezen of overgetypt kan worden. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;
export const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
