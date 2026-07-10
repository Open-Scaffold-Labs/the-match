-- ═══════════════════════════════════════════════════════════════
-- 044_tm_rounds_course_id.sql — rounds remember their course
-- ═══════════════════════════════════════════════════════════════
--
-- Phase 3 flyover shot editor (2026-07-10): tm_rounds gains course_id — the
-- golfcourseapi course id (the same external id tm_course_holes.course_id and
-- tm_outings.course_id use). The post-round shot editor needs it to load hole
-- geometry (curated tm_course_holes overrides first, OSM second) and render a
-- round's shots on the satellite hole map.
--
-- Nullable + additive: legacy rounds and free-form-course rounds stay NULL →
-- the editor falls back to its no-map list mode. Display/analytics only —
-- nothing in scoring or handicap reads it.
--
-- Backfill outing-linked rounds from their outing's course_id (solo rounds
-- have no historical source — they stay NULL).
ALTER TABLE tm_rounds ADD COLUMN IF NOT EXISTS course_id BIGINT;

UPDATE tm_rounds r
SET course_id = o.course_id
FROM tm_outings o
WHERE r.outing_id = o.id
  AND r.course_id IS NULL
  AND o.course_id IS NOT NULL;
