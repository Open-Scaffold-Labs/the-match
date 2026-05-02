-- 018_tm_leagues.sql
--
-- Paid-tier League surface (2026-05-02). Adds:
--   - tm_users.tier             — 'free' | 'elite' (default 'free').
--                                  Manual flips for testing; Stripe wiring
--                                  comes in a later migration.
--   - tm_leagues                — top-level League entity. Commissioner is
--                                  the league host; season tag groups
--                                  events into a season.
--   - tm_league_members         — many-to-many between users and leagues.
--                                  Roster persistence across events.
--   - tm_outings.league_id      — nullable FK so existing standalone
--                                  outings keep working. New "create
--                                  event in [League]" flow sets this.
--
-- Idempotent (IF NOT EXISTS) so this can be re-run safely.

-- ─── Tier flag on tm_users ────────────────────────────────────────────────
ALTER TABLE tm_users
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'elite'));

-- Optional: flip Matt to elite by default so the build is testable. Skipped —
-- Matt should run a manual UPDATE in production. Comment kept for clarity.
-- UPDATE tm_users SET tier = 'elite' WHERE handle = 'mlav';

-- ─── tm_leagues ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tm_leagues (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  commissioner_id BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  -- Free-form season label. Examples: '2026', '2026-spring', 'Tuesday Night'.
  -- Used for grouping events; can be null for "ongoing" leagues.
  season          TEXT,
  -- Default scoring rules — copied to each child outing on creation.
  -- NULL means commissioner picks per-event.
  scoring_format  TEXT,
  -- League-level config: handicap allowance %, default Stableford map,
  -- no-show policy, custom point map, etc. JSONB so the schema stays
  -- flexible.
  config          JSONB NOT NULL DEFAULT '{}',
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tm_leagues_commissioner ON tm_leagues(commissioner_id);
CREATE INDEX IF NOT EXISTS idx_tm_leagues_season       ON tm_leagues(season);

-- ─── tm_league_members ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tm_league_members (
  id          BIGSERIAL PRIMARY KEY,
  league_id   BIGINT NOT NULL REFERENCES tm_leagues(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES tm_users(id)   ON DELETE CASCADE,
  -- 'commissioner' = full control. 'player' = sees standings + events.
  -- 'spectator' = read-only.
  role        TEXT   NOT NULL DEFAULT 'player'
                CHECK (role IN ('commissioner', 'player', 'spectator')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at  TIMESTAMPTZ,        -- soft-remove for audit
  UNIQUE (league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tm_league_members_user   ON tm_league_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tm_league_members_league ON tm_league_members(league_id);

-- ─── league_id on tm_outings ──────────────────────────────────────────────
ALTER TABLE tm_outings
  ADD COLUMN IF NOT EXISTS league_id BIGINT REFERENCES tm_leagues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tm_outings_league ON tm_outings(league_id) WHERE league_id IS NOT NULL;
