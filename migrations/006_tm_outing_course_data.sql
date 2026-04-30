-- 006_tm_outing_course_data.sql
-- Add per-hole course data to outings so the Augusta scorecard can show the
-- ACTUAL pars (and yardages / stroke indices) of the course being played
-- instead of the synthetic par-3/4/5 distribution from estimateHolePars().
--
-- Source of data: GolfCourseAPI (already wired through /api/courses/:id).
-- The CreateWizard's course picker (2026-04-30) captures these on match
-- creation and stores them here. Fields are nullable so legacy matches with
-- "TBD" or free-text course names continue to work via the fallback.

ALTER TABLE tm_outings
  ADD COLUMN IF NOT EXISTS course_id      INT,
  ADD COLUMN IF NOT EXISTS course_tee     TEXT,
  ADD COLUMN IF NOT EXISTS hole_pars      JSONB,
  ADD COLUMN IF NOT EXISTS hole_yardages  JSONB,
  ADD COLUMN IF NOT EXISTS hole_handicaps JSONB;
