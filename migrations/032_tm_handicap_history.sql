-- 032_tm_handicap_history.sql
-- 2026-06-25
--
-- Persists each computed Handicap Index over time so we can derive the WHS
-- LOW HANDICAP INDEX (Rule 5.7) — the lowest Index in the trailing 365 days —
-- which the WHS soft/hard caps (Rule 5.8) are measured against. Without a
-- stored index history there is no way to compute the rolling Low HI; this is
-- exactly what the WHS-faithful consumer apps persist to implement caps.
--
-- One row per index revision (we write on each round/match completion when the
-- index updates). Low HI = MIN(handicap_index) WHERE computed_at >= now()−365d.
--
-- Append-only / idempotent.

CREATE TABLE IF NOT EXISTS tm_handicap_history (
  id             BIGSERIAL   PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  handicap_index NUMERIC(4,1) NOT NULL,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tm_handicap_history_user_date
  ON tm_handicap_history (user_id, computed_at DESC);

COMMENT ON TABLE tm_handicap_history IS
  'Per-revision Handicap Index history. Low Handicap Index (WHS 5.7) = MIN(handicap_index) over the trailing 365 days, used for the soft/hard caps (WHS 5.8). Added 2026-06-25.';
