-- 013_tm_outings_large.sql
-- Expand tm_outings to support large outings (up to 150 golfers) split
-- into foursomes, with optional macro-teams that can break down into
-- sub-teams of 2 or 4 within each foursome.
--
-- Architecture note: per the existing pattern, an outing's
-- participants live inside tm_outings.state JSONB rather than in a
-- separate table. So this migration only widens the
-- expected_players CHECK constraint — groups, teams, and per-player
-- group_id/team_id values are added to tm_outings.state by the
-- server when the host creates the outing. Apply manually:
--   psql $DATABASE_URL -f migrations/013_tm_outings_large.sql
-- (2026-05-01 — Matt: outings up to 150 with multiple foursomes.)

-- Postgres auto-names CHECK constraints; the one added in migration
-- 011 is named tm_outings_expected_players_check. Drop it and add
-- the wider one. Use IF EXISTS so the migration is re-runnable.
ALTER TABLE tm_outings
  DROP CONSTRAINT IF EXISTS tm_outings_expected_players_check;

ALTER TABLE tm_outings
  ADD CONSTRAINT tm_outings_expected_players_check
  CHECK (expected_players IS NULL OR (expected_players BETWEEN 1 AND 150));

-- Optional column persisting the host's team-breakdown choice for
-- outings with > 4 players. Allowed values:
--   'singles'    — no teams; players compete individually across all foursomes
--   'doubles'    — pairs within each foursome (2v2)
--   'foursomes'  — each foursome is one team (foursome-vs-foursome)
--   NULL         — small outing (≤4) or no team structure chosen
ALTER TABLE tm_outings
  ADD COLUMN IF NOT EXISTS team_breakdown TEXT
    CHECK (team_breakdown IS NULL OR team_breakdown IN
      ('singles', 'doubles', 'foursomes'));
