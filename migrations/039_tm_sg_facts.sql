-- 039_tm_sg_facts.sql
-- 2026-06-06
--
-- Strokes Gained phase 1 (docs/SG-DESIGN.md). Two additive changes:
--
-- 1. tm_rounds gains putt facts as PARALLEL ARRAYS (matching the existing
--    scores/hole_pars number-array convention, rather than restructuring
--    the scores entries):
--      putts        — putts per hole, e.g. [2,1,3,...]; null entries allowed
--      first_putts  — first-putt distance bucket per hole:
--                     'in3' | '3-10' | '10-25' | '25plus'
--    SG is NEVER stored — it is computed at read time from these facts
--    against the user's selected baseline (server/src/lib/sg/).
--
-- 2. tm_users gains the baseline toggle:
--      sg_baseline  — 'auto' (default; resolves from handicap index) |
--                     'tour' | 'scratch' | 'hcp-5' | 'hcp-10' | 'hcp-15' | 'hcp-20'
--
-- Idempotent — IF NOT EXISTS makes re-applying safe.

ALTER TABLE tm_rounds
  ADD COLUMN IF NOT EXISTS putts JSONB,
  ADD COLUMN IF NOT EXISTS first_putts JSONB;

COMMENT ON COLUMN tm_rounds.putts IS
  'Putts per hole, parallel to scores, e.g. [2,1,3,...]. Null/missing entries = no data for that hole (SG skips it; no fake numbers).';
COMMENT ON COLUMN tm_rounds.first_putts IS
  'First-putt distance bucket per hole, parallel to putts: in3 | 3-10 | 10-25 | 25plus.';

ALTER TABLE tm_users
  ADD COLUMN IF NOT EXISTS sg_baseline TEXT NOT NULL DEFAULT 'auto';

COMMENT ON COLUMN tm_users.sg_baseline IS
  'Strokes Gained comparison baseline: auto (from handicap) | tour | scratch | hcp-5 | hcp-10 | hcp-15 | hcp-20. The toggle (SG-DESIGN.md).';
