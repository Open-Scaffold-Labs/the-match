-- ═══════════════════════════════════════════════════════════════
-- 008_round_lineage.sql  —  Outings carry ratings + match-end emits rounds
-- ═══════════════════════════════════════════════════════════════
--
-- Two related changes that together make ended matches show up in the
-- Profile's recent-rounds list, populate the score-trend chart, and
-- (when ratings are present) feed the auto-recomputed handicap.
--
--   1. tm_outings gains course_rating + slope_rating columns. These
--      are captured at match creation when the host picks a tee that
--      came from GolfCourseAPI (which exposes the rating per tee).
--      Free-tier matches without these still work — handicap then
--      falls back to the simpler score-course_par differential.
--
--   2. tm_rounds gains outing_id — a link back to the source match.
--      With a UNIQUE(user_id, outing_id) partial index, the
--      match-end handler can INSERT idempotently and the migration
--      can backfill safely (re-runs are no-ops).
--
-- Backfill: for every already-CLOSED outing, insert one tm_rounds
-- row per non-guest participant with valid completed scores. Per
-- Matt's 2026-05-01 requirement, only fully-completed rounds count
-- (every hole has a non-zero score).
-- (created 2026-05-01)

-- ── tm_outings: rating + slope ──────────────────────────────────
ALTER TABLE tm_outings
  ADD COLUMN IF NOT EXISTS course_rating NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS slope_rating  INT;

-- ── tm_rounds: link back to source outing ───────────────────────
ALTER TABLE tm_rounds
  ADD COLUMN IF NOT EXISTS outing_id BIGINT REFERENCES tm_outings(id) ON DELETE SET NULL;

-- Drop the partial index from a prior migration attempt — ON CONFLICT
-- can't infer against a partial index without WHERE in the INSERT
-- target, which makes the helper SQL awkward. A plain UNIQUE works
-- because Postgres treats NULLs in unique indexes as DISTINCT — so
-- legacy rounds with outing_id NULL still don't conflict with each
-- other.
DROP INDEX IF EXISTS ux_tm_rounds_user_outing;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tm_rounds_user_outing
  ON tm_rounds (user_id, outing_id);

-- ── Backfill from already-closed outings ────────────────────────
-- Insert one round per non-guest participant whose scores array is
-- present, has at least 9 entries, and contains no null/zero values.
-- ON CONFLICT DO NOTHING relies on the unique index above.
INSERT INTO tm_rounds (
  user_id, outing_id, course_name, course_par,
  course_rating, slope_rating, game_type,
  scores, total, date
)
SELECT
  op.user_id,
  o.id AS outing_id,
  COALESCE(o.course_name, 'Match'),
  o.course_par,
  o.course_rating,
  o.slope_rating,
  COALESCE(o.scoring_formats->>0, 'stroke'),
  op.scores,
  op.total,
  o.created_at::date
FROM tm_outing_participants op
JOIN tm_outings o ON o.id = op.outing_id
-- tm_outing_participants only stores rows for real users (guests live
-- in tm_outings.state JSON), so the user_id NOT NULL filter is enough.
WHERE o.status = 'closed'
  AND op.user_id IS NOT NULL
  AND op.total IS NOT NULL
  AND op.scores IS NOT NULL
  AND jsonb_typeof(op.scores) = 'array'
  AND jsonb_array_length(op.scores) >= 9
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(op.scores) s
    WHERE s::text = 'null' OR s::text = '0'
  )
ON CONFLICT (user_id, outing_id) DO NOTHING;
