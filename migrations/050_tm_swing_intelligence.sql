-- ═══════════════════════════════════════════════════════════════
-- 050_tm_swing_intelligence.sql — Swing Intelligence V0 data model
-- ═══════════════════════════════════════════════════════════════
--
-- 2026-07-19 — V0 pilot per wiki/synthesis/swing-intelligence-build-spec-2026-07-16.md.
-- One module: video analysis is the core; launch-monitor ball data is an
-- OPTIONAL second stream that enriches it — never required.
--
-- Honesty contract (same doctrine as practice.js / SG gates): metrics are
-- stored deterministic; narration is computed at READ time by the Caddie;
-- every pose metric carries its own confidence; unmeasurable = NULL + flag,
-- never fabricated. Clubface is explicitly out of scope for video — that is
-- the monitor leg or nothing.
--
-- tm_swing_sessions — a filming session (range bucket, round, or archive batch).
--   context  — 'range' | 'round' | 'import'
--   source   — 'capture' (guided in-app, V1) | 'archive' (V0 batch import)
--
-- tm_swings — one detected swing inside a session clip.
--   video_ref     — user-owned storage reference; metrics outlive footage.
--   duration_ms   — takeaway → impact, from frame indexes (tempo engine).
--   tempo_ratio   — backswing : downswing (Tour Tempo lineage, ~3:1).
--   pose_metrics  — JSONB, per-metric { value, confidence } objects:
--                   backswing length, hip/shoulder turn, sway, early
--                   extension, head movement. NULL value + flag when the
--                   camera angle can't support the measurement.
--   flags         — text[] of honesty markers ('face_on_only', 'no_impact_audio',
--                   'low_confidence', ...). Never empty-claim.
--
-- tm_ball_data — OPTIONAL launch-monitor stats, session- or swing-level.
--   source   — 'manual' | 'csv' | 'garmin'
--   swing_id — nullable join: set only when timestamps align per-swing;
--              session-level pairing is the default (spec §5).
--
-- Apply on prod by hand: psql "$DATABASE_URL" -f migrations/050_tm_swing_intelligence.sql

CREATE TABLE IF NOT EXISTS tm_swing_sessions (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  context     TEXT        NOT NULL CHECK (context IN ('range','round','import')),
  club_slot   TEXT,
  notes       TEXT,
  source      TEXT        NOT NULL DEFAULT 'capture' CHECK (source IN ('capture','archive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tm_swing_sessions_user_date
  ON tm_swing_sessions (user_id, date DESC);

CREATE TABLE IF NOT EXISTS tm_swings (
  id            BIGSERIAL   PRIMARY KEY,
  session_id    BIGINT      NOT NULL REFERENCES tm_swing_sessions(id) ON DELETE CASCADE,
  video_ref     TEXT,
  clip_start_ms INTEGER,
  duration_ms   INTEGER,        -- takeaway → impact; NULL when undetectable
  tempo_ratio   NUMERIC(5,2), -- backswing : downswing; NULL when undetectable
  frames        JSONB,          -- { takeaway, top, impact } frame indexes
  pose_metrics  JSONB,          -- per-metric { value, confidence } or NULL value
  flags         TEXT[]        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tm_swings_session ON tm_swings (session_id);

CREATE TABLE IF NOT EXISTS tm_ball_data (
  id          BIGSERIAL   PRIMARY KEY,
  session_id  BIGINT      NOT NULL REFERENCES tm_swing_sessions(id) ON DELETE CASCADE,
  swing_id    BIGINT      REFERENCES tm_swings(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ,             -- monitor timestamp; enables per-swing join
  club_speed  NUMERIC(6,2),
  ball_speed  NUMERIC(6,2),
  smash       NUMERIC(4,3),
  launch_deg  NUMERIC(5,2),
  spin        INTEGER,
  carry       NUMERIC(6,1),
  total       NUMERIC(6,1),
  source      TEXT        NOT NULL CHECK (source IN ('manual','csv','garmin')),
  device      TEXT,                    -- 'Rapsodo MLM2', 'Garmin R10', 'Mevo', ...
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tm_ball_data_session ON tm_ball_data (session_id);
CREATE INDEX IF NOT EXISTS idx_tm_ball_data_swing   ON tm_ball_data (swing_id) WHERE swing_id IS NOT NULL;
