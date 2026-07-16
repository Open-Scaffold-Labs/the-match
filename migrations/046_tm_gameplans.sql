-- ═══════════════════════════════════════════════════════════════
-- 046_tm_gameplans.sql — Game Day Strategy (GamePlan) Phase 0
-- ═══════════════════════════════════════════════════════════════
--
-- 2026-07-15 (wiki/synthesis/gameday-strategy-build-spec-2026-07-15.md):
-- stored night-before hole-by-hole plans. One row per generation; the
-- newest row per (user, course, tee, mode) is "the plan". Kept (not
-- upserted) because Phase 2's learning loop (SG: Discipline) replays
-- rounds against the exact plan the golfer saw, so history must survive
-- regeneration.
--
-- plan JSONB shape (composed server-side, Claude via forced tool use):
--   { summary: { headline, decisiveHoles: [int], leak, expectedRange },
--     holes: [{ hole, par, yards, si, netStroke, club, aim, avoid,
--               expect, why }] }
-- facts JSONB — the deterministic inputs the narrative was built from
-- (course handicap, stroke allocation, history digest, SG digest), stored
-- so Phase 2 can re-derive discipline scoring without re-computation drift.

CREATE TABLE IF NOT EXISTS tm_gameplans (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  course_id   BIGINT,                      -- golfcourseapi id (nullable: typed-own courses)
  course_name TEXT         NOT NULL,
  tee_name    TEXT,
  gender      TEXT,                        -- which tee table the plan priced ('male'|'female')
  mode        TEXT         NOT NULL DEFAULT 'medal',  -- medal | net | money
  plan        JSONB        NOT NULL,
  facts       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- "Latest plan for this user/course" is the hot path (re-open, voice tee brief).
CREATE INDEX IF NOT EXISTS idx_tm_gameplans_user_course
  ON tm_gameplans (user_id, course_id, created_at DESC);
