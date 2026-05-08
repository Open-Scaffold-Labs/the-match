-- 026_tm_referrals.sql
--
-- Referral / invite-link program (Matt 2026-05-07 PM3).
--
-- Reward model:
--   Referrer earns Elite credit when they cross qualifying-signup milestones:
--     5 qualifying signups   → 7 days  Elite (incremental: +7d)
--     10 qualifying signups  → 30 days Elite (incremental: +23d on top)
--     50 qualifying signups  → 365 days Elite (incremental: +335d on top)
--   Referee earns 7 days Elite at signup when they used a ref link.
--
--   "Qualifying" means: signed up via a referral link AND played at least
--   one round (solo OR a matched outing). The activity gate prevents
--   alt-account gaming. Lifetime counts (no annual reset for v1).
--
-- Schema:
--   tm_referral_codes   — 1:1 with tm_users; lazily created on first
--                         GET /api/me/referral. UNIQUE on code so no
--                         collisions; the generator retries on conflict.
--   tm_referrals        — one row per referee. UNIQUE(referee_id) means
--                         a user can only be referred ONCE — even if
--                         multiple referrers race, the second loses.
--   tm_referral_rewards — append-only audit of milestone awards.
--                         UNIQUE(user_id, milestone) means we never
--                         double-credit a milestone.
--   tm_users.elite_until — nullable timestamptz. The "is this user
--                         Elite?" check is now: tier='elite' OR
--                         elite_until > NOW(). Time-limited Elite
--                         from referrals + signup bonuses extend this
--                         column; Stripe-purchased Elite (POST-LAUNCH-TODO
--                         #18) will set tier='elite' permanently.

BEGIN;

CREATE TABLE IF NOT EXISTS tm_referral_codes (
  user_id     BIGINT PRIMARY KEY REFERENCES tm_users(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tm_referrals (
  id                   BIGSERIAL PRIMARY KEY,
  referrer_id          BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  referee_id           BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  signed_up_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qualifying_round_at  TIMESTAMPTZ,
  -- A user can only be referred ONCE, full stop. Prevents the same
  -- account from being claimed by multiple referrers.
  CONSTRAINT tm_referrals_referee_unique UNIQUE (referee_id),
  -- Self-referral defense at the DB layer in addition to the route check.
  CONSTRAINT tm_referrals_no_self CHECK (referrer_id <> referee_id)
);

-- Hot path: list referrals for a referrer + count qualifying.
CREATE INDEX IF NOT EXISTS tm_referrals_referrer_qual_idx
  ON tm_referrals (referrer_id)
  WHERE qualifying_round_at IS NOT NULL;

-- Used when a referee logs their first round and we need to find their
-- (single) referrer row to set qualifying_round_at.
CREATE INDEX IF NOT EXISTS tm_referrals_referee_idx
  ON tm_referrals (referee_id);

CREATE TABLE IF NOT EXISTS tm_referral_rewards (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  milestone       INTEGER NOT NULL CHECK (milestone IN (5, 10, 50)),
  days_credited   INTEGER NOT NULL CHECK (days_credited > 0),
  awarded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tm_referral_rewards_user_milestone_unique UNIQUE (user_id, milestone)
);

-- elite_until — time-limited Elite entitlement granted by referral
-- rewards or referee signup bonus. The application-layer "is Elite?"
-- check OR's this against tier='elite'. NULL = no time-limited
-- entitlement.
ALTER TABLE tm_users
  ADD COLUMN IF NOT EXISTS elite_until TIMESTAMPTZ;

COMMIT;
