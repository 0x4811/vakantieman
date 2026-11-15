-- vakantieman: eerste schema.
-- Analyses worden alleen opgeslagen ná toepassing van het detailniveau van de foto.

CREATE TABLE photos (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  r2_key          TEXT NOT NULL,
  masked_r2_key   TEXT,
  true_lat        REAL NOT NULL,
  true_lon        REAL NOT NULL,
  true_place      TEXT NOT NULL,
  reveal_level    TEXT NOT NULL CHECK (reveal_level IN ('country', 'city', 'district', 'street')),
  sensitivity     TEXT NOT NULL CHECK (sensitivity IN ('public', 'private')),
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE analyses (
  id              TEXT PRIMARY KEY,
  photo_id        TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  variant         TEXT NOT NULL CHECK (variant IN ('original', 'masked')),
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  result_json     TEXT NOT NULL,
  approved        INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_analyses_photo ON analyses (photo_id, variant);

CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  photo_id            TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  analysis_id         TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  masked_analysis_id  TEXT REFERENCES analyses(id) ON DELETE SET NULL,
  state               TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created', 'live', 'ended')),
  started_at          TEXT,
  ended_at            TEXT,
  summary_json        TEXT,
  created_at          TEXT NOT NULL
);
