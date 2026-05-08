-- 027_tm_rounds_hole_pars.sql
-- 2026-05-07 PM
--
-- Adds hole_pars JSONB to tm_rounds so solo rounds can persist their
-- per-hole pars. Previously hole_pars only existed on tm_outings, which
-- meant solo rounds (no outing) could never be re-rendered with real
-- per-hole pars — RoundScorecard fell back to estimateHolePars(coursePar)
-- which spreads par evenly across holes (not realistic for any real
-- course).
--
-- Why this matters now: the client now passes config.pars in the
-- POST /api/rounds payload so the server can detect per-hole
-- achievements (first_birdie, first_eagle, first_par, hole_in_one)
-- on solo rounds. Storing those same pars on the row means the round
-- detail GET can also return real pars instead of synthetic ones —
-- the scorecard will show 4-3-5-4-... matching what the user actually
-- played, not 4-4-4-4-... default rotation.
--
-- Idempotent — IF NOT EXISTS makes re-applying safe.

ALTER TABLE tm_rounds
  ADD COLUMN IF NOT EXISTS hole_pars JSONB;

COMMENT ON COLUMN tm_rounds.hole_pars IS
  'Per-hole pars JSONB array, e.g. [4,4,3,4,5,4,3,5,4,...]. Set on solo rounds (no outing). For outing-linked rounds, hole_pars lives on tm_outings — leave this null and JOIN through outing_id when reading.';
