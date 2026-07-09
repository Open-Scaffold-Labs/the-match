-- Curated per-course hole layouts (tee + green + optional aim, per hole).
--
-- This is the AUTHORITATIVE, human-verified layout Eagle Eye uses BEFORE any OSM
-- reconstruction. It's the fix for courses OSM maps without golf=hole routing
-- (e.g. Beacon Hill CC — 18 greens + 45 tees but zero hole numbers, so nothing
-- can reliably say which green/tee is which hole). Free, on-stack, scalable: a
-- course is mapped ONCE via the in-app "Map this course" editor (greens are
-- auto-seeded from OSM; the user taps them in playing order + confirms tees),
-- then the layout is exact forever and compounds as members map home courses.
--
-- course_id is the golfcourseapi id (courseCtx.course.id, e.g. 23476). Coords
-- are nullable so a partially-mapped course still stores what's known. A hole
-- present here with a tee AND green renders as a CONFIDENT hole line in Eagle
-- Eye (holeGeometries seeded from tee→(aim)→green). (2026-07-09)
CREATE TABLE IF NOT EXISTS tm_course_holes (
  course_id   BIGINT      NOT NULL,
  hole        SMALLINT    NOT NULL CHECK (hole BETWEEN 1 AND 18),
  tee_lat     DOUBLE PRECISION,
  tee_lon     DOUBLE PRECISION,
  green_lat   DOUBLE PRECISION,
  green_lon   DOUBLE PRECISION,
  aim_lat     DOUBLE PRECISION,   -- optional dogleg / aim point (tee→aim→green)
  aim_lon     DOUBLE PRECISION,
  updated_by  BIGINT,             -- tm_users.id of the mapper (audit; no FK — course_id is external)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, hole)
);
