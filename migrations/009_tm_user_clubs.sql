-- 009_tm_user_clubs.sql
-- User bag inventory — actual clubs (brand + model) per slot.
-- (2026-05-01 — Matt: My Bag rewrite from "Coming soon" to real UI.)
--
-- Slot enum is fixed: 14 standard slots covering driver / fairway woods
-- / hybrids / irons / wedges / putter. A user fills any subset; missing
-- slots = no club assigned. Brand + model are free-form strings backed
-- by a curated client-side catalog (clubCatalog.js).

CREATE TABLE IF NOT EXISTS tm_user_clubs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  slot        TEXT        NOT NULL CHECK (slot IN (
                'driver', '3w', '5w', '7w',
                'hybrid_1', 'hybrid_2',
                'iron_3', 'iron_4', 'iron_5', 'iron_6', 'iron_7', 'iron_8', 'iron_9',
                'pw', 'gw', 'sw', 'lw',
                'putter'
              )),
  brand       TEXT        NOT NULL,
  model       TEXT        NOT NULL,
  position    INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slot)
);

CREATE INDEX IF NOT EXISTS tm_user_clubs_user_idx ON tm_user_clubs (user_id);

-- updated_at trigger reuses the global helper from 001
DROP TRIGGER IF EXISTS tm_user_clubs_updated_at ON tm_user_clubs;
CREATE TRIGGER tm_user_clubs_updated_at
  BEFORE UPDATE ON tm_user_clubs
  FOR EACH ROW EXECUTE FUNCTION tm_set_updated_at();
