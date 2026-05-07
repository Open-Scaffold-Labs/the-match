-- ─── 023_tm_games_guests.sql ────────────────────────────────────────────────
-- Adds named-guest support to scheduled tee times. Until now, tm_games only
-- accepted user_id-based participants via tm_game_participants. The new
-- "+ New Tee Time" flow on Home lets the host roster real app users AND
-- name-only guests (their 4th who doesn't have an account yet). Stored as
-- JSONB on tm_games rather than a separate table because guests are not
-- relational — they don't have user pages, can't accept invites, can't be
-- looked up by id. Each entry: { name: "Bob Smith" }. Guests show up in
-- the participant list on UpcomingTeeTimes / calendar / live-match start
-- but don't get push notifications (no account to push to).
--
-- Also adds confirmed_by_creator: when the host says "we already agreed on
-- the phone", invitees are auto-accepted (status='accepted' on insert)
-- instead of starting at 'pending'. Push copy adapts to the difference.
--
-- (2026-05-06.)

ALTER TABLE tm_games
  ADD COLUMN IF NOT EXISTS guests             JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_by_creator BOOL  NOT NULL DEFAULT false;
