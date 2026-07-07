-- 042 — per-shot capture in outings (self-score only).
--
-- Mirrors 041 (live putt capture): an optional, self-entered per-hole shot
-- log — a jsonb array of per-hole shot arrays [[{club, lie, toPin}, …], …] —
-- lives on the participant row and flows into tm_rounds.shots at outing end
-- (the outing→round sync in routes/outings.js), where the read-time Strokes
-- Gained engine (server/src/lib/sg) turns COMPLETE per-hole chains into
-- OTT/APP/ARG. Additive + nullable; it never gates scoring (a plain score
-- write leaves it untouched, exactly like putts/first_putts).
--
-- Reversible: ALTER TABLE tm_outing_participants DROP COLUMN shots;

ALTER TABLE tm_outing_participants
  ADD COLUMN IF NOT EXISTS shots jsonb;
