-- 051 — Survive the course vendor's breaking API change (2026-08-08)
--
-- WHAT CHANGED, UPSTREAM, WITHOUT NOTICE:
-- Between 2026-07-17 and 2026-07-23 the course data vendor made two breaking
-- changes at once. Both are verified against their live API and against our own
-- tm_course_search_cache history:
--
--   1. Course ids went from INTEGERS to ALPHANUMERIC STRINGS.
--        2026-07-17  "la tourette" -> id 23978
--        2026-08-08  "la tourette" -> id "pjvj6c9d"
--
--   2. location.latitude / location.longitude were REMOVED from both /search
--      and /courses/:id. A street `address` was added in their place.
--        2026-07-17 keys: city, club_name, country, course_name, id, latitude, longitude, state
--        2026-08-08 keys: city, club_name, country, course_name, id, state
--
-- WHY IT BLANKED THE HOLE MAP (silently, which is the worst part):
-- EagleEye anchors its OSM/Overpass load on the course coordinates. With none
-- supplied it falls back to geocoding "club_name, city, state" — and for
-- "La Tourette Golf Club, Staten Island, NY" Nominatim returns ZERO results
-- (measured). So `gc` is null, EagleEye returns at "no location anywhere",
-- courseGeocoded stays null, and HoleMapGL's init effect bails on `!geocoded`.
-- The map never initialises: no tiles, no error, no retry card — just the
-- background colour, which is dark green. A dead map and a loading map are
-- pixel-identical, which is why this cost a full night to find.
--
-- TWO CHANGES HERE, both additive/widening — no data loss, no destructive DDL.

-- 1) course ids must hold strings.
--    bigint -> text preserves every existing numeric id as its digit string.
--    Postgres can cast bigint->text implicitly for USING, so this is safe and
--    fast on a table this size. Old numeric ids keep working because the server
--    passes req.params.id through as a string either way.
ALTER TABLE tm_course_cache
  ALTER COLUMN course_id TYPE text USING course_id::text;

-- 2) Coordinates we resolve ourselves, cached forever.
--    Geocoding is a slow, rate-limited, third-party call (Nominatim asks for
--    <=1 req/sec) and a course does not move. Resolve once, reuse always.
--    Keyed by the vendor's course id as text so it works for BOTH id formats.
CREATE TABLE IF NOT EXISTS tm_course_geocode (
  course_id    text PRIMARY KEY,
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  -- 'vendor'    = the API still gave us coordinates (preferred; free, exact)
  -- 'nominatim' = we geocoded location.address ourselves
  -- 'manual'    = hand-corrected, must never be overwritten by an automatic pass
  source       text NOT NULL DEFAULT 'nominatim',
  query        text,                      -- exactly what we geocoded, for auditing a bad pin
  resolved_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tm_course_geocode_lat_ck CHECK (latitude  BETWEEN  -90 AND  90),
  CONSTRAINT tm_course_geocode_lon_ck CHECK (longitude BETWEEN -180 AND 180)
);

-- Seed the one course Matt is playing this morning from a KNOWN-GOOD value:
-- the vendor's own coordinates for it, captured in tm_course_search_cache on
-- 2026-07-17 before they removed the field. This is the vendor's number, not a
-- guess, and not dependent on Nominatim being up at 6am.
INSERT INTO tm_course_geocode (course_id, latitude, longitude, source, query)
VALUES ('pjvj6c9d', 40.5761, -74.14681, 'vendor',
        'vendor coordinates for La Tourette Golf Club, captured 2026-07-17 pre-removal')
ON CONFLICT (course_id) DO NOTHING;
