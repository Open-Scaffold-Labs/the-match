-- 041_tm_outing_participants_putts.sql
-- 2026-07-06
--
-- Live putt capture in outings (wiki/synthesis/live-putt-capture-outings-
-- build-spec-2026-07-06.md). SELF-scored putt facts stash on the player's
-- participant row during a live outing and are carried into their tm_rounds
-- record at /end (fan-out re-cleans counts against final scores).
--
-- Parallel per-hole arrays — identical convention to tm_rounds (039):
--   putts        — putt count per hole, e.g. [2,null,1,...]; null = no data
--   first_putts  — first-putt bucket per hole: in3 | 3-10 | 10-25 | 25plus
--
-- SG never reads these columns — SG reads tm_rounds only. Facts only;
-- written ONLY by the player themselves (writer === target, enforced in
-- routes/outings.js). Idempotent — IF NOT EXISTS makes re-applying safe.

ALTER TABLE tm_outing_participants
  ADD COLUMN IF NOT EXISTS putts JSONB,
  ADD COLUMN IF NOT EXISTS first_putts JSONB;

COMMENT ON COLUMN tm_outing_participants.putts IS
  'Per-hole putt counts self-entered during the live outing, parallel to scores. Carried into tm_rounds at /end. Null entries = no data (no fake numbers).';
COMMENT ON COLUMN tm_outing_participants.first_putts IS
  'Per-hole first-putt distance bucket (in3|3-10|10-25|25plus), parallel to putts.';
