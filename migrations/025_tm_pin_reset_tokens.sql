-- 025_tm_pin_reset_tokens.sql
--
-- "Forgot PIN" reset flow (audit-2026-05-07 medium bug #5).
-- Stores one-time tokens emailed to the user; consumed by POST /api/auth/reset-pin.
--
-- Email delivery is currently STUBBED in server/src/routes/auth.js — when
-- a Resend/SendGrid/SES key is added to env, the placeholder console.log
-- becomes a real send. Until then, the token is created but nothing is
-- sent (admin can copy the token from server logs to test). Documented
-- in the commit message + auth.js comments.

CREATE TABLE IF NOT EXISTS tm_pin_reset_tokens (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,            -- 32-byte base64url, ~43 chars
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,            -- created_at + 30 minutes
  consumed_at     TIMESTAMPTZ,                     -- set when used; null = unused
  request_ip      TEXT,                            -- for abuse tracking
  CONSTRAINT tm_pin_reset_tokens_consumed_after_create CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT tm_pin_reset_tokens_expires_after_create  CHECK (expires_at > created_at)
);

-- Lookup by token (the single hot path, on POST /api/auth/reset-pin).
-- UNIQUE constraint on `token` already creates a btree index, so this
-- is just for partial-on-unused — most lookups want unconsumed + unexpired.
CREATE INDEX IF NOT EXISTS tm_pin_reset_tokens_user_unconsumed_idx
  ON tm_pin_reset_tokens (user_id, expires_at)
  WHERE consumed_at IS NULL;
