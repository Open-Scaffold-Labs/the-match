-- 037_tm_idempotency_keys.sql
-- Track F.5 S3 — "never lose your round" idempotency layer. Lets the offline
-- queue replay a queued score write (after a dropped ack, reconnect, or app
-- restart) WITHOUT double-applying it. SAFE + REVERSIBLE: a new table only;
-- nothing uses it until the flagged S3 code is enabled AND the client starts
-- sending an Idempotency-Key header, so applying this has ZERO behavior change.
--
-- Apply by hand:
--   psql "$DATABASE_URL" -f migrations/037_tm_idempotency_keys.sql
--
-- Design notes (see wiki/synthesis/f5-s2-s3-build-spec-2026-06-28.md):
--   * Uniqueness is scoped (user_id, idempotency_key) — never global — so two
--     users can coincidentally reuse a key and one can never read another's
--     cached response (a data-leak vector).
--   * request_hash (sha256 of the canonical body) detects key reuse with a
--     DIFFERENT payload → the server returns 422 instead of a wrong cached reply.
--   * recovery_point ('started' | 'finished') + locked_at let a crashed handler's
--     claim be reclaimed by a later retry instead of wedging forever.
--   * response_code/response_body store the first reply so a replay is byte-
--     identical. Correctness does NOT depend on a TTL — a golf phone can sit
--     offline for days; created_at only drives storage cleanup (7-day window),
--     never dedup correctness.

CREATE TABLE IF NOT EXISTS tm_idempotency_keys (
  id              BIGSERIAL   PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,                                  -- NULL once finished
  user_id         BIGINT      NOT NULL,
  idempotency_key TEXT        NOT NULL CHECK (char_length(idempotency_key) <= 100),
  request_method  TEXT        NOT NULL,
  request_path    TEXT        NOT NULL,
  request_hash    TEXT        NOT NULL,                         -- sha256 hex of canonical body
  recovery_point  TEXT        NOT NULL DEFAULT 'started',       -- 'started' | 'finished'
  response_code   INTEGER,
  response_body   JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS tm_idempotency_keys_user_key
  ON tm_idempotency_keys (user_id, idempotency_key);

-- Drives the opportunistic cleanup sweep only (DELETE WHERE created_at < now()
-- - interval '7 days'); NOT used for dedup decisions.
CREATE INDEX IF NOT EXISTS tm_idempotency_keys_created_at
  ON tm_idempotency_keys (created_at);
