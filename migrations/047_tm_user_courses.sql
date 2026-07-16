-- ═══════════════════════════════════════════════════════════════
-- 047_tm_user_courses.sql — community-added courses
-- ═══════════════════════════════════════════════════════════════
--
-- 2026-07-15 (Dale): private clubs are exactly where the GolfCourseAPI
-- free-tier dataset (~30k) is thin — verified live: "Augusta National"
-- returns zero from the vendor. A member enters their club ONCE (name,
-- pars, optional yardage/SI/rating) and every user can pick it from then
-- on. Community rows ride alongside vendor results in /api/courses/search
-- with source:'community' and id 'u<row id>' (string-prefixed so they can
-- never collide with vendor integer ids anywhere downstream — tm_rounds/
-- tm_outings.course_id stay vendor-only, community picks flow through the
-- same courseName/hole_pars path typed-own courses already use).
--
-- hole_pars  — required, 9 or 18 ints (JSONB array)
-- hole_yards — optional, same length
-- hole_sis   — optional stroke indexes, same length
-- One tee per community course in v1 ("Standard" unless named). Ratings
-- optional; when absent, handicap math falls back exactly as typed-own
-- courses do today (never fabricate).

CREATE TABLE IF NOT EXISTS tm_user_courses (
  id            BIGSERIAL    PRIMARY KEY,
  created_by    INT          NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  club_name     TEXT         NOT NULL,
  course_name   TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  tee_name      TEXT,
  course_rating NUMERIC(4,1),
  slope_rating  INT,
  hole_pars     JSONB        NOT NULL,
  hole_yards    JSONB,
  hole_sis      JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Search path: ILIKE on the two name fields.
CREATE INDEX IF NOT EXISTS idx_tm_user_courses_club_name
  ON tm_user_courses (lower(club_name));
