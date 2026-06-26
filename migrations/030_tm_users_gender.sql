-- 030_tm_users_gender.sql
-- 2026-06-25
--
-- Adds a gender field to the user profile. Foundational, not cosmetic: gender
-- drives correct TEE handling (men's vs women's tees → different yardages),
-- course/slope rating + handicap math, and gender-appropriate defaults — the
-- kind of thing a national-scale golf app must get right.
--
-- Nullable + never required: existing users have NULL (handled gracefully
-- everywhere; behaviour defaults exactly as today until set). The app
-- constrains values to 'male' | 'female' (room to extend later); the column
-- itself stays a permissive TEXT so a future value never needs a migration.
--
-- Append-only. IF NOT EXISTS makes re-applying safe.

ALTER TABLE tm_users ADD COLUMN IF NOT EXISTS gender TEXT;

COMMENT ON COLUMN tm_users.gender IS
  'Player gender (app-constrained to male|female, nullable/optional). Drives tee handling, rating/handicap math, and gender-appropriate defaults. Added 2026-06-25.';
