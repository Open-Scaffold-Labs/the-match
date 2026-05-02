-- 017_tm_score_audit.sql
-- Append-only audit log for every score change inside an outing.
-- Captures who changed what, when, and the before/after values so:
--   1. Score-conflict overwrites can be detected and warned about
--      (server returns 409 with the existing value when a non-host
--      tries to overwrite a different non-zero score).
--   2. Commissioners can investigate disputes ("hole 7 was a 4 last
--      time I checked, who changed it to 5?").
--   3. The score-correction panel has historical context.
--
-- Apply manually:
--   psql $DATABASE_URL -f migrations/017_tm_score_audit.sql
-- (2026-05-01 — league must-have B2.)

CREATE TABLE IF NOT EXISTS tm_score_audit (
  id              BIGSERIAL PRIMARY KEY,
  outing_id       BIGINT      NOT NULL REFERENCES tm_outings(id) ON DELETE CASCADE,
  -- The participant whose score was changed.
  user_id         BIGINT      NOT NULL,
  -- Hole index (0-based, matches the scores[] array convention used
  -- everywhere else in the app).
  hole            INT         NOT NULL CHECK (hole >= 0 AND hole < 18),
  old_score       INT,
  new_score       INT         NOT NULL,
  -- Who made the change. Nullable to support legacy / system writes,
  -- but every modern path will fill this in.
  edited_by_id    BIGINT      REFERENCES tm_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Most common query: "show me every change for this outing, newest first"
-- (the host's correction panel uses this).
CREATE INDEX IF NOT EXISTS tm_score_audit_outing_idx
  ON tm_score_audit (outing_id, created_at DESC);

-- Targeted lookup: "what's the latest score for player X on hole H?"
-- Used by the conflict-warning path on the server.
CREATE INDEX IF NOT EXISTS tm_score_audit_player_hole_idx
  ON tm_score_audit (outing_id, user_id, hole, created_at DESC);
