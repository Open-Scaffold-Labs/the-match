-- ═══════════════════════════════════════════════════════════════
-- 049_tm_ota_bundles.sql — self-hosted OTA update bundles + stats
-- ═══════════════════════════════════════════════════════════════
--
-- 2026-07-16 (Option A greenlit by Matt): The Match self-hosts its OTA
-- backend instead of Capgo Cloud. The @capgo/capacitor-updater plugin in the
-- native binary POSTs to our updateUrl on every app open; the server answers
-- from this table. Full design + wire contract:
-- wiki/synthesis/self-hosted-ota-scoping-2026-07-16.md and docs/OTA-RUNBOOK.md.
--
-- tm_ota_bundles — one row per published web bundle.
--   version            — semver (plugin requirement); compared against the
--                        device's current bundle version.
--   channel            — 'production' for v1 ('beta' etc. later).
--   url                — public HTTPS URL of the zip (Supabase Storage).
--   checksum           — SHA256 from `npx @capgo/cli bundle zip --json`
--                        (MUST be produced by the Capgo CLI — its zip layout
--                        is what the plugin expects; hand-zips can fail).
--   min_native_version — the native app version (CFBundleShortVersionString)
--                        this bundle requires. THE native-compatibility
--                        safety gate: a bundle that calls a native plugin the
--                        installed binary lacks would crash the app; the
--                        endpoint never serves a bundle to a binary older
--                        than this.
--   active             — the bundle the endpoint serves. AT MOST ONE active
--                        per channel (partial unique index). Rollback = flip
--                        active to an older row (scripts/ota-rollback.mjs).
--
-- tm_ota_stats — best-effort device telemetry from the plugin's statsUrl
-- (update lifecycle, crash/health signals). Append-only, no PII beyond the
-- plugin's random per-install device_id. Prunable any time.
--
-- Apply on prod by hand: psql "$DATABASE_URL" -f migrations/049_tm_ota_bundles.sql

CREATE TABLE IF NOT EXISTS tm_ota_bundles (
  id                  BIGSERIAL   PRIMARY KEY,
  app_id              TEXT        NOT NULL DEFAULT 'com.openscaffoldlabs.thematch',
  version             TEXT        NOT NULL,
  channel             TEXT        NOT NULL DEFAULT 'production',
  url                 TEXT        NOT NULL,
  checksum            TEXT        NOT NULL,
  size_bytes          BIGINT,
  min_native_version  TEXT        NOT NULL,
  active              BOOLEAN     NOT NULL DEFAULT false,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, channel, version)
);

-- At most one ACTIVE bundle per (app, channel).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_ota_bundles_one_active
  ON tm_ota_bundles (app_id, channel) WHERE active;

CREATE TABLE IF NOT EXISTS tm_ota_stats (
  id          BIGSERIAL   PRIMARY KEY,
  app_id      TEXT,
  device_id   TEXT,
  platform    TEXT,
  action      TEXT,
  version     TEXT,
  old_version TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tm_ota_stats_created ON tm_ota_stats (created_at);
