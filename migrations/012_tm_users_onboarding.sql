-- 012_tm_users_onboarding.sql
-- First-run onboarding state + coach-mark tracking on tm_users.
-- (2026-05-01 — Matt: friends-test prep, mandatory wizard + checklist
-- + per-tab coach marks.)

ALTER TABLE tm_users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS onboarding_steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS coach_marks_seen JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Promote Matt's primary account to admin so the home-page admin
-- gear icon renders for him. The role column already exists from
-- 001 (TEXT NOT NULL DEFAULT 'user'). Explicit email match avoids
-- accidentally promoting the wrong row.
UPDATE tm_users SET role = 'admin' WHERE email = 'mlav1114@aol.com';

-- Seeded test profiles (Dale, Chris, Ryan, Sam, Taylor) and existing
-- real users get onboarding marked complete so the wizard doesn't
-- ambush them next time they sign in. New signups still flow through
-- it.
UPDATE tm_users
   SET onboarding_completed_at = NOW(),
       onboarding_steps = '{"welcome":true,"handicap":true,"home_course":true,"first_club":true,"friend":true}'::jsonb
 WHERE onboarding_completed_at IS NULL
   AND created_at < NOW();
