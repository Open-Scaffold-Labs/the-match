-- 038_tm_participants_guests.sql
-- Track F.5 S4 — give guests real tm_outing_participants rows (prerequisite for
-- S5 reader-flip + S7 cutover). SAFE + ADDITIVE: guest rows use user_id = NULL,
-- and EVERY existing guest exclusion keys on user_id (recent-matches
-- `user_id IS NOT NULL`, rounds co-participants `user_id IS NOT NULL`, /end
-- rounds-emit `if (!p.user_id) continue`, h2h joins on user_id, handicap via
-- tm_rounds) — so a NULL-user_id guest row stays excluded from all of them with
-- ZERO query changes. Nothing reads guest rows until S5; until then this only
-- adds durable storage. Guest writes are additionally flag-gated
-- (SCORING_GUEST_ROWS) in the app.
--
-- Apply by hand:
--   psql "$DATABASE_URL" -f migrations/038_tm_participants_guests.sql

-- 1) Allow guest rows: user_id becomes nullable; add guest identity columns.
ALTER TABLE tm_outing_participants ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tm_outing_participants ADD COLUMN IF NOT EXISTS is_guest   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tm_outing_participants ADD COLUMN IF NOT EXISTS guest_id   TEXT;
ALTER TABLE tm_outing_participants ADD COLUMN IF NOT EXISTS guest_name TEXT;

-- 2) One guest row per (outing, guest_id). Real-user rows have guest_id NULL;
--    NULLs are distinct in a unique index, so they never collide here.
CREATE UNIQUE INDEX IF NOT EXISTS tm_outing_participants_guest
  ON tm_outing_participants (outing_id, guest_id);

-- 3) Shape guard: a row is EITHER a real user (user_id set, not a guest) OR a
--    guest (user_id NULL, is_guest TRUE, guest_id set). Existing rows all pass
--    (they have user_id and default is_guest = FALSE), so this validates clean.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tm_op_guest_shape') THEN
    ALTER TABLE tm_outing_participants ADD CONSTRAINT tm_op_guest_shape CHECK (
      (is_guest = FALSE AND user_id IS NOT NULL) OR
      (is_guest = TRUE  AND user_id IS NULL AND guest_id IS NOT NULL)
    );
  END IF;
END $$;

-- 4) Backfill: create rows for guests that currently live only in
--    state.participants[]. Idempotent — re-running is a no-op.
INSERT INTO tm_outing_participants (outing_id, user_id, is_guest, guest_id, guest_name, scores, total)
SELECT o.id, NULL, TRUE, p->>'user_id', p->>'name',
       COALESCE(p->'scores', '[]'::jsonb),
       COALESCE(NULLIF(p->>'total','')::int, 0)
FROM tm_outings o,
     LATERAL jsonb_array_elements(o.state->'participants') p
WHERE COALESCE((p->>'is_guest')::boolean, FALSE) IS TRUE
  AND p->>'user_id' IS NOT NULL
ON CONFLICT (outing_id, guest_id) DO NOTHING;
