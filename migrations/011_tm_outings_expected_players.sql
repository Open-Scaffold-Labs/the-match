-- 011_tm_outings_expected_players.sql
-- Captures the expected number of golfers when the host creates a
-- match in the Outing wizard. Used by the Live Now card on the Match
-- page to show "Waiting for N more" until the field fills up.
-- (2026-05-01 — Matt: wizard should ask number of golfers.)

ALTER TABLE tm_outings
  ADD COLUMN IF NOT EXISTS expected_players INTEGER
    CHECK (expected_players IS NULL OR (expected_players BETWEEN 1 AND 8));
