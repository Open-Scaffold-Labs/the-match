---
type: synthesis
created: 2026-06-29
updated: 2026-06-29
tags: [the-match, f5, scoring, guests, data-model, build-plan, s4]
---

# F.5 S4 — Guests get real rows (build spec)

*Prerequisite for S5 (flip readers to row-derived) and S7 (stop writing `state` scores): if readers stop trusting `state` while guests live only in `state`, guest scores vanish. S4 gives guests durable rows FIRST. Grounded in a full blast-radius inventory of every `tm_outing_participants` write/read, every `user_id`-based guest exclusion, and the `/end`/handicap/h2h/rounds paths (session record).*

## The core design decision (and why it shrinks the blast radius)

Guests currently live ONLY in `tm_outings.state.participants[]` with a string id `guest_<ts>` and `is_guest:true`; they have **no** `tm_outing_participants` row. `tm_outing_participants.user_id` is `BIGINT NOT NULL REFERENCES tm_users` — guests can't get a row as-is.

**Decision: guest rows use `user_id = NULL` + `is_guest = TRUE` + `guest_id` + `guest_name`.** This is the safe choice because **every existing guest exclusion keys on `user_id`**, verified in the inventory:

- recent-matches opponent list — `AND p2.user_id IS NOT NULL` (`outings.js:533`)
- round co-participants — `AND op.user_id IS NOT NULL` (`rounds.js:181`)
- `/end` rounds-emit — `if (!p.user_id) continue` (`outings.js:2054`)
- h2h shared CTE / `tm_match_history` / `tm_h2h_records` — join + pair on `user_id` (NULL never matches)
- handicap — reads `tm_rounds` (`user_id NOT NULL`), which guests never get

A guest row with `user_id = NULL` is therefore excluded from all of them **with zero query changes**. The naive alternative (give guests a non-null synthetic `user_id`) would silently flip all of those to *include* guests → corrupted stats. We avoid that entirely.

Consequence: **S4 is purely additive.** Guest rows are written (mirroring `state`) but nothing reads them yet — readers flip in S5. Flag-gated for reversibility.

## Schema (migration 038, append-only)

```sql
ALTER TABLE tm_outing_participants ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tm_outing_participants ADD COLUMN IF NOT EXISTS is_guest   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tm_outing_participants ADD COLUMN IF NOT EXISTS guest_id   TEXT;
ALTER TABLE tm_outing_participants ADD COLUMN IF NOT EXISTS guest_name TEXT;
-- one guest row per (outing, guest_id); real rows have guest_id NULL → NULLs are
-- distinct, so they never collide on this index.
CREATE UNIQUE INDEX IF NOT EXISTS tm_outing_participants_guest ON tm_outing_participants (outing_id, guest_id);
-- shape guard: a row is EITHER a real user (user_id set, not guest) OR a guest
-- (user_id NULL, is_guest, guest_id set). Existing rows all pass (user_id set, is_guest FALSE).
ALTER TABLE tm_outing_participants ADD CONSTRAINT tm_op_guest_shape CHECK (
  (is_guest = FALSE AND user_id IS NOT NULL) OR
  (is_guest = TRUE  AND user_id IS NULL AND guest_id IS NOT NULL)
);
```
- `DROP NOT NULL` + `ADD COLUMN ... DEFAULT` + the CHECK validate against existing rows (all have `user_id`, default `is_guest FALSE`) → safe, instant.
- **Backfill** existing state-only guests into rows (idempotent via `ON CONFLICT DO NOTHING`):
```sql
INSERT INTO tm_outing_participants (outing_id, user_id, is_guest, guest_id, guest_name, scores, total)
SELECT o.id, NULL, TRUE, p->>'user_id', p->>'name',
       COALESCE(p->'scores','[]'::jsonb), COALESCE((p->>'total')::int, 0)
FROM tm_outings o, LATERAL jsonb_array_elements(o.state->'participants') p
WHERE (p->>'is_guest')::boolean IS TRUE
ON CONFLICT (outing_id, guest_id) DO NOTHING;
```

## Server (flag `SCORING_GUEST_ROWS`, default off)

Both changes are additive; nothing reads guest rows yet.

1. **`POST /:code/guests`** — after the existing `state` push, when the flag is on, `INSERT` a guest row `(outing_id, user_id=NULL, is_guest=TRUE, guest_id, guest_name, scores)` `ON CONFLICT (outing_id, guest_id) DO NOTHING`.
2. **Guest branch of `/scores/host`** (`isGuest` path) — after the existing `state` update, when the flag is on, `UPDATE` the guest row's `scores`/`total` keyed by `(outing_id, guest_id)`. Keep `state` in sync (until S7).

No change to the `writeScoreAudit` guest skip, the achievements guest skip, or any reader — guests still aren't audited / handicapped / paired (correct).

## What S4 deliberately does NOT do
- Does NOT flip any reader to row-derived (that's S5). Leaderboard/CSV/`/end` still read guests from `state`.
- Does NOT change exclusion queries — they keep working via `user_id NULL`.
- Does NOT remove the `state` guest entries — dual-write until S7 cutover.

## Verification plan
- **The safety thesis (must prove):** insert a guest row (`user_id NULL`, `is_guest`) into an outing with real users on sandbox Postgres, then run the ACTUAL exclusion queries (recent-matches opponent subquery, `rounds.js` co-participants, the `/end` rounds-emit guard, the rivalries shared CTE) and assert the guest does NOT appear in any of them.
- **Migration:** `DROP NOT NULL` + columns + CHECK + unique index apply clean on a fresh replay; existing-row CHECK passes; backfill creates correct guest rows and is idempotent on re-run.
- **Write paths:** guest create inserts a row; guest score writes update it; `state` stays in sync; survives reload.
- **Live beta e2e:** flag on — create outing + guest via API, score the guest, confirm a guest row exists with `user_id NULL` AND the guest does NOT appear in the host's `/recent` opponent list or rivalries. Clean up all test data.
- **Gate:** `node --check` + client lint + build + server tests; audit-before-claim pass.

## Failure-mode register

| Risk | Mitigation |
|---|---|
| Guests start polluting handicap/h2h/rounds/recent once they have rows | `user_id = NULL` → all existing `user_id`-keyed exclusions hold; **proven by test**, not assumed |
| CHECK constraint rejects existing rows on apply | Existing rows have `user_id` set + `is_guest` default FALSE → pass; verified on fresh replay |
| Double-counting (guest in `state` AND row) in a reader | No reader reads guest rows in S4; readers flip in S5 after this is proven |
| Backfill duplicates on re-run | `ON CONFLICT (outing_id, guest_id) DO NOTHING` |
| Guest row write fails and blocks scoring | Additive + flagged; row write is best-effort relative to the `state` write that already works |
| `guest_id` collisions across outings | Unique scoped to `(outing_id, guest_id)`, not global |
