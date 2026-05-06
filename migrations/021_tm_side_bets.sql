-- ─── 021_tm_side_bets.sql ───────────────────────────────────────────────────
-- Side-bet declarations attached to an outing. The MVP supports two
-- types:
--   • 'nassau'  — head-to-head match-play between two participants,
--                 split into front 9 / back 9 / total 18, with optional
--                 manual presses. Stakes = $/match.
--   • 'skins'   — multi-player carryover bet. Each hole has a value;
--                 winner of the hole takes the value plus any carried
--                 amount from prior tied holes.
--
-- All math is computed CLIENT-SIDE from the outing's existing per-hole
-- scores — this table only stores the declaration. That keeps the server
-- stateless and lets the standings update live as scores come in
-- without round-trip writes for every hole. (lib/side-bets.js on both
-- client and server houses the compute helpers.)
--
-- config JSONB shape per type:
--   nassau:  { stakes: number, participant_ids: [bigint, bigint],
--              presses: [{ start_hole: int, between_ids: [bigint,bigint] }] }
--   skins:   { stakes: number, participant_ids: [bigint, ...] }
--
-- (2026-05-06 — polish task #7)

CREATE TABLE IF NOT EXISTS tm_outing_side_bets (
  id          BIGSERIAL    PRIMARY KEY,
  outing_id   BIGINT       NOT NULL REFERENCES tm_outings(id) ON DELETE CASCADE,
  type        TEXT         NOT NULL,
  config      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_by  BIGINT       NOT NULL REFERENCES tm_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tm_outing_side_bets_outing
  ON tm_outing_side_bets (outing_id);
