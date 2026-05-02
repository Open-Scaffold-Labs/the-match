-- 016_tm_push_subscriptions.sql
-- Stores web-push subscription endpoints per user. One user can have
-- multiple devices/browsers subscribed (phone PWA + iPad PWA + laptop
-- desktop browser, for example), so the table is keyed on (user_id,
-- endpoint). Endpoint is also UNIQUE on its own — a single browser's
-- push subscription endpoint should never belong to two accounts.
--
-- Apply manually:
--   psql $DATABASE_URL -f migrations/016_tm_push_subscriptions.sql
--
-- (2026-05-01 — Matt: web push notifications.)

CREATE TABLE IF NOT EXISTS tm_push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  endpoint    TEXT        NOT NULL UNIQUE,
  -- The two keys come from the browser's PushSubscription.toJSON() —
  -- p256dh is the user's ECDH public key, auth is the user-agent's
  -- random secret. Both are required for web-push to encrypt payloads.
  p256dh      TEXT        NOT NULL,
  auth        TEXT        NOT NULL,
  -- Useful for debugging and per-device management later.
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup index for the most common query: "send a push to this user
-- across all their devices".
CREATE INDEX IF NOT EXISTS tm_push_subscriptions_user_idx
  ON tm_push_subscriptions (user_id);
