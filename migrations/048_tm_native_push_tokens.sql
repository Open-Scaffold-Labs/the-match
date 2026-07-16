-- ═══════════════════════════════════════════════════════════════
-- 048_tm_native_push_tokens.sql — APNs device tokens (native app)
-- ═══════════════════════════════════════════════════════════════
--
-- 2026-07-16: The App Store (Capacitor) build receives notifications via
-- APNs, not web push. The native shell registers with APNs, gets a device
-- token, and POSTs it to /api/notifications/register-native. This table
-- stores those tokens, scoped to the authenticated user, separate from the
-- web tm_push_subscriptions table (different delivery channel).
--
-- token    — the APNs device token (hex string); UNIQUE so re-registration
--            from the same device upserts one row (and can move to a new
--            user_id if the device signs into a different account).
-- platform — 'ios' | 'android' (future); defaults 'ios'.
--
-- Apply on prod by hand: psql "$DATABASE_URL" -f migrations/048_tm_native_push_tokens.sql

CREATE TABLE IF NOT EXISTS tm_native_push_tokens (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     INT         NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE,
  platform    TEXT        NOT NULL DEFAULT 'ios',
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tm_native_push_tokens_user ON tm_native_push_tokens(user_id);
