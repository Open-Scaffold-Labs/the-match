-- The Match — Migration 005
-- Add start_time to tm_games so matches scheduled on the same day are
-- distinguishable on the Home dashboard's "Upcoming Tee Times" section.
-- Audit finding R6 / 2026-04-29.
--
-- Run against your Supabase project via:
--   psql $DATABASE_URL -f migrations/005_tm_match_start_time.sql
--
-- Schema choices:
-- - Column is NULLABLE so existing rows (created before this migration)
--   keep working without backfill. They'll display without a time stamp.
-- - Type is TIME (no timezone) — golf tee times are inherently local-time
--   ("8 AM at the course"), so storing wall-clock is correct. The user's
--   timezone is determined client-side by geolocation when they play; the
--   database just holds the local time the user picked. The Supabase
--   server timezone is irrelevant.
-- - No default value — the create-match form requires the user to pick a
--   time going forward. Old rows keep NULL.

ALTER TABLE tm_games
  ADD COLUMN IF NOT EXISTS start_time TIME;

-- Optional index — speeds up "today's matches sorted by time" queries.
-- Safe to add now; harmless if the queries don't use it.
CREATE INDEX IF NOT EXISTS tm_games_date_time_idx
  ON tm_games (date, start_time);
