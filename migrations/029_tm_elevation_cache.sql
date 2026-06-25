-- 029_tm_elevation_cache.sql
-- 2026-06-25
--
-- Durable cache for terrain-elevation lookups used by the transparent,
-- adjustable plays-like feature (Phase 3.1). The live yardage's "plays like"
-- number breaks into wind / elevation / temperature; the elevation term needs
-- the elevation of the player's spot and the target (green/aim), so it can
-- compute the uphill/downhill delta. Elevation is queried from a public DEM
-- (USDA/USGS 3DEP via the EPQS point service for the US; ~1 m resolution,
-- public domain, keyless) and cached here.
--
-- Why a durable cache (mirrors the tm_osm_cache rationale, migration 028):
--   * Terrain elevation at a coordinate is STATIC — once fetched it never
--     needs refetching, so this cache has no TTL (a row is served forever).
--   * The previous-tier in-memory cache vanishes on every Vercel cold start;
--     a row here survives, so the public DEM service is hit at most once per
--     ~1 m coordinate cell, keeping us a polite API citizen.
--
-- Keyed by rounded coordinates (~5 dp ≈ 1.1 m — fine enough to distinguish
-- tee/green, coarse enough to get cache hits as the player walks):
--   lat_round, lon_round — the request coords rounded to 5 decimal places
--   elevation_ft         — resolved elevation in FEET (the plays-like model
--                          works in feet→yards); NULL is never stored, a
--                          no-data lookup is simply not cached
--   source               — which DEM answered ('usgs' now; 'openmeteo' when
--                          the worldwide fallback is wired)
--   fetched_at           — provenance only; rows are not expired
--
-- Idempotent — IF NOT EXISTS makes re-applying safe. Append-only migration.

CREATE TABLE IF NOT EXISTS tm_elevation_cache (
  lat_round    NUMERIC(8,5)  NOT NULL,
  lon_round    NUMERIC(9,5)  NOT NULL,
  elevation_ft NUMERIC(7,1)  NOT NULL,
  source       TEXT          NOT NULL DEFAULT 'usgs',
  fetched_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (lat_round, lon_round)
);

COMMENT ON TABLE tm_elevation_cache IS
  'Durable cache of terrain-elevation (DEM) lookups keyed by coordinates rounded to ~5 dp (~1.1 m). Backs the plays-like elevation term (Phase 3.1). Elevation is static, so rows have no TTL and the public DEM service is hit at most once per coordinate cell. source = which DEM answered (usgs | openmeteo).';
