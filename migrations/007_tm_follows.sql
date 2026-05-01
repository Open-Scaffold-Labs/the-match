-- ═══════════════════════════════════════════════════════════════
-- 007_tm_follows.sql  —  Asymmetric follow graph (Phase 1)
-- ═══════════════════════════════════════════════════════════════
--
-- Replaces the bidirectional friend system (tm_friends) with an
-- asymmetric follow model. follower_id → following_id, no acceptance
-- step required. Mutual relationships are derived on the fly:
--   mutual = exists row both (A, B) and (B, A).
--
-- Phase 1 only creates the table + backfills from tm_friends. The old
-- friends API and UI keep running in parallel until Phase 2 swaps the
-- consumers (Home friends panel, FriendProfile, Outing player picker)
-- and drops tm_friends.
--
-- Idempotent — every INSERT uses ON CONFLICT DO NOTHING so re-running
-- the migration is safe.
-- (created 2026-05-01)

-- ── tm_follows ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tm_follows (
  id            BIGSERIAL PRIMARY KEY,
  follower_id   BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  following_id  BIGINT NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower  ON tm_follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON tm_follows (following_id);

-- ── Backfill from tm_friends ─────────────────────────────────────

-- 1. Accepted friendships → bidirectional follows (one row each direction)
INSERT INTO tm_follows (follower_id, following_id, created_at)
SELECT requester_id, requestee_id,
       COALESCE(updated_at, created_at, NOW())
FROM tm_friends
WHERE status = 'accepted'
ON CONFLICT (follower_id, following_id) DO NOTHING;

INSERT INTO tm_follows (follower_id, following_id, created_at)
SELECT requestee_id, requester_id,
       COALESCE(updated_at, created_at, NOW())
FROM tm_friends
WHERE status = 'accepted'
ON CONFLICT (follower_id, following_id) DO NOTHING;

-- 2. Pending requests → one-way follow (requester is now following requestee).
--    Requestee can choose to follow back later. Declined rows are dropped.
INSERT INTO tm_follows (follower_id, following_id, created_at)
SELECT requester_id, requestee_id,
       COALESCE(created_at, NOW())
FROM tm_friends
WHERE status = 'pending'
ON CONFLICT (follower_id, following_id) DO NOTHING;
