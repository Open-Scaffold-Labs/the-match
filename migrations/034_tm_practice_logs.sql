-- 034_tm_practice_logs.sql
-- 2026-06-26
--
-- Persists practice results for the data → practice loop (Leapfrog 3.5). When a
-- player logs a drill from their weekly session, we record what they did AND a
-- snapshot of the weakness metric at that moment (metric_value, lower = better).
-- Later, after they've logged more rounds, /api/practice re-measures the same
-- weakness and shows before → after — the closed loop no incumbent owns.
--
-- One row per drill logged. Append-only / idempotent.

CREATE TABLE IF NOT EXISTS tm_practice_logs (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  weakness_id  TEXT        NOT NULL,   -- the focus area (par_type, blowups, …)
  drill_id     TEXT        NOT NULL,   -- which drill was done
  target       TEXT,                   -- the benchmark target shown to the player
  passed       BOOLEAN,                -- did they hit the target
  value        TEXT,                   -- optional free-form result ("6/9")
  metric_value NUMERIC,                -- snapshot of the weakness metric (lower=better)
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tm_practice_logs_user_date
  ON tm_practice_logs (user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS tm_practice_logs_user_weakness
  ON tm_practice_logs (user_id, weakness_id, logged_at DESC);

COMMENT ON TABLE tm_practice_logs IS
  'Practice-loop results (Leapfrog 3.5). Each drill logged with a snapshot of the weakness metric at log time, so a later analysis can show before→after improvement. Added 2026-06-26.';
