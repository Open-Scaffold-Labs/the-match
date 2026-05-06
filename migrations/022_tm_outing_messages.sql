-- ─── 022_tm_outing_messages.sql ─────────────────────────────────────────────
-- Per-outing group chat. Every participant of an outing can post; messages
-- belong to exactly one outing and are deleted with it (CASCADE). Polling-
-- based — no websockets in v1. Clients pass `?since=<id>` to GET only the
-- new messages since their last fetch.
--
-- Body is capped server-side (500 chars). HTML is stored as plain text;
-- the client never trusts message content for rendering.
--
-- Index ordered by (outing_id, id DESC) so the GET endpoint's
-- "newest 100, optionally since cursor" query runs from a single index
-- scan without sorting.
--
-- (2026-05-06 — polish task #8)

CREATE TABLE IF NOT EXISTS tm_outing_messages (
  id          BIGSERIAL    PRIMARY KEY,
  outing_id   BIGINT       NOT NULL REFERENCES tm_outings(id) ON DELETE CASCADE,
  user_id     BIGINT       NOT NULL REFERENCES tm_users(id) ON DELETE SET NULL,
  body        TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tm_outing_messages_outing_id
  ON tm_outing_messages (outing_id, id DESC);
