-- 040_tm_users_tendencies.sql
-- 2026-06-06
--
-- Player tendency profile (SG phase 3, docs/SG-DESIGN.md "AI Caddie
-- contract"). Three self-reported tendencies captured in onboarding (new
-- OPTIONAL 'tendencies' step — NOT added to BLOCKING_STEPS, so existing
-- users are never re-walled) and editable via profile/update. They feed
-- the Eagle Eye / AI Caddie system prompt alongside club distances and
-- the Strokes Gained block:
--
--   shot_shape    — 'draw' | 'fade' | 'straight'   (usual ball flight)
--   typical_miss  — 'left' | 'right' | 'both'      (directional miss)
--   distance_miss — 'short' | 'long' | 'pin_high'  (distance miss; most
--                                                   amateurs are short)
--
-- All nullable: unknown tendencies are simply omitted from the prompt —
-- never guessed.
--
-- Idempotent — IF NOT EXISTS makes re-applying safe.

ALTER TABLE tm_users
  ADD COLUMN IF NOT EXISTS shot_shape TEXT,
  ADD COLUMN IF NOT EXISTS typical_miss TEXT,
  ADD COLUMN IF NOT EXISTS distance_miss TEXT;

COMMENT ON COLUMN tm_users.shot_shape IS
  'Self-reported usual ball flight: draw | fade | straight. Feeds the AI caddie prompt (SG phase 3).';
COMMENT ON COLUMN tm_users.typical_miss IS
  'Self-reported directional miss: left | right | both.';
COMMENT ON COLUMN tm_users.distance_miss IS
  'Self-reported distance miss: short | long | pin_high.';
