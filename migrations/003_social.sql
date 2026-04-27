-- ═══════════════════════════════════════════════════════════════
-- 003_social.sql  — Friends, Availability, Tee Requests, Seasons
-- ═══════════════════════════════════════════════════════════════

-- Add profile fields to users
ALTER TABLE tm_users ADD COLUMN IF NOT EXISTS home_course TEXT;
ALTER TABLE tm_users ADD COLUMN IF NOT EXISTS bio TEXT;

-- ── Friends ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tm_friends (
  id           BIGSERIAL PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  requestee_id BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (requester_id, requestee_id),
  CHECK (requester_id <> requestee_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_requestee ON tm_friends (requestee_id);
CREATE INDEX IF NOT EXISTS idx_friends_requester ON tm_friends (requester_id);

-- ── Availability ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tm_availability (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_availability_user_date ON tm_availability (user_id, date);

-- ── Tee Time Requests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tm_tee_time_requests (
  id           BIGSERIAL PRIMARY KEY,
  from_user_id BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  to_user_id   BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  course_name  TEXT,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tee_requests_to   ON tm_tee_time_requests (to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tee_requests_from ON tm_tee_time_requests (from_user_id);

-- ── User Seasons ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tm_user_seasons (
  user_id      BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  season_year  INT    NOT NULL,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY  (user_id, season_year)
);
