-- 019_tm_user_verification.sql
-- Email verification on signup (Phase 1 — email-only via Resend).
-- (2026-05-02 — Matt: "set this up so it has no chance of continuing
-- to happen" — push silently failed for weeks because new accounts
-- weren't anchored to a verified contact channel.)
--
-- Phase 1 ships email-only. SMS/phone is intentionally deferred until
-- a billable provider (Twilio) gets wired up. The schema here uses
-- a `channel` column on tm_verification_codes so adding 'sms' later
-- is a routing change in code, not a migration.

ALTER TABLE tm_users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL;

-- Verification codes are short-lived (10 min), one-time-use, attempt-
-- capped (5 wrong tries → row marked consumed). Code is stored as a
-- bcrypt hash so a DB leak doesn't expose live codes. Channel column
-- is the forward hook for SMS without another migration.
CREATE TABLE IF NOT EXISTS tm_verification_codes (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  channel      TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms')),
  code_hash    TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ NULL,
  attempts     INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active code per user per channel — simplifies verify-by-user
-- lookup ("the latest unconsumed unexpired code for this user").
CREATE INDEX IF NOT EXISTS tm_verification_codes_user_channel_idx
  ON tm_verification_codes (user_id, channel, created_at DESC);

-- Grandfather every existing user as verified so nobody gets locked
-- out. Test profiles (Dale, Chris, Ryan, Sam, Taylor) get the same
-- treatment so they remain usable as senders for test friend
-- requests. New signups (created_at >= NOW()) flow through verify.
-- (Matt: "yes grandfather all".)
UPDATE tm_users
   SET email_verified_at = NOW()
 WHERE email_verified_at IS NULL;
