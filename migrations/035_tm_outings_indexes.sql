-- 035_tm_outings_indexes.sql
-- Track F.3 / audit N9: tm_outings had NO index on status or host_id, yet hot
-- paths filter on them:
--   * friends-live           → WHERE o.status = 'active'      (routes/outings.js)
--   * season aggregation     → WHERE status IN ('closed','cancelled')
--   * host-ownership checks   → WHERE host_id = $1
-- As tm_outings grows these become full table scans. Add the indexes now while
-- the table is small; adding them to a large hot table later is a slow,
-- lock-sensitive operation.
--
-- CONCURRENTLY = no write lock while the index builds (safe on the live table).
-- It cannot run inside a transaction block — apply this file on its own:
--   psql "$DATABASE_URL" -f migrations/035_tm_outings_indexes.sql
-- (psql runs statements in autocommit, so CONCURRENTLY is fine here.)

-- Partial index on the overwhelmingly common "active" lookups keeps the index
-- small and the active-outing scans fast.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tm_outings_status_active
  ON tm_outings (status)
  WHERE status = 'active';

-- General status index for the closed/cancelled season aggregations.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tm_outings_status
  ON tm_outings (status);

-- Host-ownership lookups.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tm_outings_host_id
  ON tm_outings (host_id);
