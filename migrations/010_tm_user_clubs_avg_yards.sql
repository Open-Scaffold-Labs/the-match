-- 010_tm_user_clubs_avg_yards.sql
-- Add a nullable average-distance column to the bag inventory so users
-- can record their expected carry/total per club. Putter slot leaves
-- this NULL (no meaningful distance for a putter).
-- (2026-05-01 — Matt: per-club expected distance after picking
-- brand/model in My Bag.)

ALTER TABLE tm_user_clubs
  ADD COLUMN IF NOT EXISTS avg_yards INTEGER
    CHECK (avg_yards IS NULL OR (avg_yards >= 0 AND avg_yards <= 400));
