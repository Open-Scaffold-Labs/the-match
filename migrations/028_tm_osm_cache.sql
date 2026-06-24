-- 028_tm_osm_cache.sql
-- 2026-06-24
--
-- Durable cache for OpenStreetMap golf geometry (Overpass responses), so the
-- public Overpass API is no longer used as a live production backend — which
-- is against its usage policy and rate-limited. Each (osm_type, bbox) is
-- fetched from Overpass at most once, then served from this table.
--
-- Why this matters now: the previous server-side cache was an in-memory Map
-- (server/src/routes/eagle-eye.js) that vanishes on every Vercel cold start,
-- so in practice we were hammering the public Overpass mirrors on most
-- requests. A row here survives cold starts.
--
-- Keyed by (osm_type, bbox):
--   osm_type — the allowlisted query kind: holes | teegreen | greengeom
--   bbox     — the exact "south,west,north,east" string the client requested
--   data     — the raw Overpass JSON response
--   fetched_at — lets us expire stale geometry (courses rarely change, so the
--                server uses a long TTL; a stale row is still served if every
--                Overpass mirror is down — better stale geometry than none).
--
-- Idempotent — IF NOT EXISTS makes re-applying safe.

CREATE TABLE IF NOT EXISTS tm_osm_cache (
  osm_type    TEXT        NOT NULL,
  bbox        TEXT        NOT NULL,
  data        JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, bbox)
);

COMMENT ON TABLE tm_osm_cache IS
  'Durable cache of Overpass (OSM golf geometry) responses keyed by (osm_type, bbox). Replaces the ephemeral in-memory cache so the public Overpass API is hit at most once per course/bbox. Refreshed when fetched_at is older than the server TTL; served stale as a last resort when all Overpass mirrors are down.';
