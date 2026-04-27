-- The Match — initial schema
-- Run against your Supabase project via:
--   psql $DATABASE_URL -f migrations/001_tm_initial.sql

-- Users
CREATE TABLE IF NOT EXISTS tm_users (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  pin_hash    TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'golfer',
  handicap    NUMERIC(4,1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rounds
CREATE TABLE IF NOT EXISTS tm_rounds (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  course_name   TEXT        NOT NULL,
  course_par    INT         NOT NULL DEFAULT 72,
  course_rating NUMERIC(4,1),
  slope_rating  INT,
  game_type     TEXT        NOT NULL DEFAULT 'stroke',
  scores        JSONB       NOT NULL DEFAULT '[]',
  shots         JSONB       NOT NULL DEFAULT '[]',
  total         INT         NOT NULL DEFAULT 0,
  date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tm_rounds_user_date ON tm_rounds (user_id, date DESC);

-- Outings (live group tournaments)
CREATE TABLE IF NOT EXISTS tm_outings (
  id          BIGSERIAL PRIMARY KEY,
  code        CHAR(4)     NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  host_id     BIGINT      NOT NULL REFERENCES tm_users(id),
  course_name TEXT        NOT NULL,
  course_par  INT         NOT NULL DEFAULT 72,
  team_format TEXT        NOT NULL DEFAULT 'individual',
  point_method TEXT,
  scoring_formats JSONB   NOT NULL DEFAULT '["stroke"]',
  state       JSONB       NOT NULL DEFAULT '{}',
  status      TEXT        NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Club stats (last 50 shots per club per user)
CREATE TABLE IF NOT EXISTS tm_club_stats (
  user_id     BIGINT  NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  club_data   JSONB   NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id)
);

-- Updated_at trigger helper
CREATE OR REPLACE FUNCTION tm_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER tm_users_updated_at    BEFORE UPDATE ON tm_users    FOR EACH ROW EXECUTE FUNCTION tm_set_updated_at();
CREATE TRIGGER tm_outings_updated_at  BEFORE UPDATE ON tm_outings  FOR EACH ROW EXECUTE FUNCTION tm_set_updated_at();
