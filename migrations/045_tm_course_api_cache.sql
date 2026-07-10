-- ═══════════════════════════════════════════════════════════════
-- 045_tm_course_api_cache.sql — durable cache for the course-data vendor
-- ═══════════════════════════════════════════════════════════════
--
-- 2026-07-10: the GolfCourseAPI free tier hit its rate limit and every
-- /api/courses/search silently returned 200 {courses: []} (the route did
-- `d.courses || []`), so course search looked dead app-wide — surfaced by
-- Matt with GPS off, where no OSM nearby list masks it.
--
-- Same pattern as tm_osm_cache (028): cache-through on the server so the
-- public vendor is hit at most once per query/course per TTL, and STALE
-- rows are served when the vendor errors (stale-if-error) — search and
-- course loads keep working through vendor outages and rate limits.
--
-- Payloads are our own mapped shapes (not raw vendor), WITHOUT any
-- location-dependent fields (distance is computed per request).
CREATE TABLE IF NOT EXISTS tm_course_search_cache (
  q          TEXT        PRIMARY KEY,           -- normalized: lowercase, single-spaced
  payload    JSONB       NOT NULL,              -- mapped courses array (no distance_km)
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tm_course_cache (
  course_id  BIGINT      PRIMARY KEY,           -- golfcourseapi id
  payload    JSONB       NOT NULL,              -- mapped course detail (GET /:id response body)
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
