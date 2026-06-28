-- 036_tm_participants_score_version.sql
-- Track F.5 / audit N3 — additive scaffolding for optimistic-concurrency on
-- live scores ("never lose your round"). SAFE + REVERSIBLE: adds one column
-- with a default; nothing reads it until the flagged F.5 code is enabled, so
-- applying this has ZERO behavior change on its own.
--
-- Apply by hand (small, instant — not CONCURRENTLY-sensitive, it's an ADD
-- COLUMN with a constant default which Postgres does as a metadata-only change
-- on PG11+):
--   psql "$DATABASE_URL" -f migrations/036_tm_participants_score_version.sql
--
-- How the flagged F.5 code will use it (NOT in this migration):
--   * Score-on-behalf writes (PUT /scores/host) will do
--       UPDATE ... SET scores=$1, total=$2, score_version=score_version+1
--       WHERE id=$id AND score_version=$expected
--     and treat 0 rows updated as a 409 conflict — surfacing BOTH values and
--     never silently clobbering (beats the incumbents' last-write-wins).
--   * Self-scoring (PUT /scores) stays last-write-wins (you own your own card)
--     but still bumps score_version so an on-behalf writer sees the change.
--   * The leaderboard read derives from these rows (authoritative), ending the
--     stale-JSONB-state bug.

ALTER TABLE tm_outing_participants
  ADD COLUMN IF NOT EXISTS score_version INTEGER NOT NULL DEFAULT 0;
