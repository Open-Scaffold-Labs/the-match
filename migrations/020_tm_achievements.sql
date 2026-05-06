-- ─── 020_tm_achievements.sql ────────────────────────────────────────────────
-- Light achievements / badges system. Each row is one user earning one
-- achievement TYPE for the first time. The (user_id, type) unique index
-- enforces "first-time only" for the v1 set:
--   • first_eagle  — first hole scored at par-2 or better
--   • sub_80       — first 18-hole round under 80 strokes total
--   • streak_week  — first 7-day window with ≥3 rounds played
--
-- New achievement types can be added without a schema change. Some
-- achievements are intentionally "first time only" (v1 set, all of them)
-- so the unique index is correct; if a future achievement should be
-- repeatable (e.g., "10 birdies in a round") drop the unique constraint
-- and de-dupe in lib/achievements.js instead.
--
-- context_outing_id is the outing in which this achievement was earned,
-- when applicable (for solo-round-only achievements like sub_80 from a
-- standalone round, it stays NULL). metadata holds the small payload the
-- unlock card renders ("a 3 on a par 5 (eagle)" for first_eagle).
--
-- (2026-05-06 — polish task #5)

CREATE TABLE IF NOT EXISTS tm_achievements (
  id                BIGSERIAL    PRIMARY KEY,
  user_id           BIGINT       NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  type              TEXT         NOT NULL,
  context_outing_id BIGINT,
  metadata          JSONB,
  earned_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Enforce first-time-only at the DB layer for the v1 set.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tm_achievements_user_type
  ON tm_achievements (user_id, type);

-- Profile-fetch query: most-recent earned first.
CREATE INDEX IF NOT EXISTS ix_tm_achievements_user_earned
  ON tm_achievements (user_id, earned_at DESC);
