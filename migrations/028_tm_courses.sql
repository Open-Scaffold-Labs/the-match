-- 028_tm_courses.sql
-- Read-through cache for Golf Course API course detail.
--
-- The vendor (golfcourseapi.com) free tier is 50 requests/day shared across
-- ALL users, and server/src/routes/courses.js previously proxied
-- /api/courses/:id live on every call — so course-detail fetches drew down
-- that 50/day budget on every scorecard view. Course data is effectively
-- static, so we cache the raw vendor `course` object here and serve repeat
-- lookups from Postgres. After warm-up a given course costs ~0 vendor calls.
--
-- Stores the raw vendor object (not the mapped response) so the response
-- shaping stays in application code and the cache survives mapping changes.
-- Additive + idempotent; safe to apply on a live DB. (2026-06-01 — see
-- wiki/POST-LAUNCH-TODO.md #25.)

CREATE TABLE IF NOT EXISTS tm_courses (
  id          BIGINT PRIMARY KEY,            -- Golf Course API course id
  raw         JSONB NOT NULL,                -- raw vendor `course` object
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
