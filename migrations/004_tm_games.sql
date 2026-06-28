-- 004_tm_games.sql  — REPAIR migration (added 2026-06-28)
--
-- WHY THIS EXISTS / WHY THE ODD NAME:
-- `tm_games` (scheduled tee times / games) is referenced by 005 (ADD start_time)
-- and 023 (ADD guests, confirmed_by_creator) but was NEVER created by any
-- migration — it only ever existed on the live Supabase project (created
-- out-of-band). So a from-scratch rebuild via the documented
--   for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
-- FAILED at 005 ("relation tm_games does not exist"), meaning a new
-- environment / disaster-recovery restore could not be built from the
-- migrations. Found 2026-06-28 while replaying all migrations on a clean
-- Postgres to verify the F.6 change.
--
-- This file is named `004_tm_games.sql` so it sorts AFTER `004_avatar.sql`
-- and BEFORE `005_*` in the glob, creating the base table before 005/023
-- alter it. It is NOT editing any existing numbered migration (append-only
-- respected). `IF NOT EXISTS` makes it a no-op on the live DB, which already
-- has the table.
--
-- The columns here are the BASE table as it existed BEFORE 005 and 023:
-- start_time is added by 005; guests + confirmed_by_creator by 023; the
-- (date, start_time) index by 005. Reconstructed from the live schema
-- (information_schema + pg_constraint) — the source of truth.

CREATE TABLE IF NOT EXISTS tm_games (
  id            BIGSERIAL   PRIMARY KEY,
  created_by    BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  date          DATE        NOT NULL,
  course_name   TEXT,
  request_type  TEXT        NOT NULL DEFAULT 'tee_time',
  message       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  broadcast     BOOLEAN     DEFAULT false
);
