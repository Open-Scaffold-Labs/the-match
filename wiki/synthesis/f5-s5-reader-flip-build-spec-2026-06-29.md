---
type: synthesis
created: 2026-06-29
updated: 2026-06-29
tags: [the-match, f5, scoring, readers, build-plan, s5]
---

# F.5 S5 — Flip remaining readers to row-derived (build spec)

*The last step before S7 can stop writing `state` scores: every reader that still ranks/aggregates off `state.participants[].total` must derive scores from the authoritative `tm_outing_participants` rows. Grounded in a precise per-reader inventory (session record). `/:code` + `/:code/public` are already row-derived (S1b); this finishes the job for the four that remain.*

## The four readers

| Reader | Reads today | Reads only closed? | Flip |
|---|---|---|---|
| `GET /outings/friends-live` | `state.participants[].total`/`.holes_played` for leader + current-hole on **active** matches | No (active) | derive total/holes from `op.scores` |
| `GET /outings/season/:season` | `state.participants[].total` to rank + aggregate | **Yes (closed/cancelled)** | derive total per participant from row scores, re-sort, re-aggregate |
| `GET /leagues/:id/standings` | `state.participants[].total` (+ `.scores` for skins/stableford) via `rankParticipants` | **Yes** | feed row-derived scores/total into `rankParticipants` |
| `GET /outings/:code/export.csv` | already computes total from `op.scores`; guests from `state` | n/a | add guest rows (`guest_id`/`guest_name`) to the lookup |

## Guiding rules (parity is the hard requirement)

1. **Only the score VALUES flip to rows.** The participant *list*, `withdrawn`/`no_show` flags, group/team ids, and the scoring-format config stay sourced from `state` — that's snapshot/config data, not scores, and it's exactly what survives into S7 (state becomes config-only).
2. **Preserve keying exactly, including guests.** For each `state.participants[]` entry, look up its row by `user_id` (app user) or `guest_id` (guest, since guest rows have `user_id = NULL`). Derive total via the existing `deriveScoreTotals(row.scores, fallbackTotal, fallbackHoles)` helper. **Fall back to `state.total` when no row exists** (guest created pre-flag, or any gap). Because both stores are synced today, row-derived == state-derived → identical output.
3. **Closed outings are already frozen** — `state.total` of a closed outing equals its final row total, so for season/leagues this is a no-op *today*; the flip matters for outings closed *after* S7 (no `state` scores then).
4. **New flag `SCORING_AGG_READ_FROM_ROWS` (default off)** — NOT the already-on `SCORING_READ_FROM_ROWS`. Lets us ship dark, prove parity against real prod closed outings, then flip. When off, every reader behaves exactly as today.

## Build (each reader)

- **friends-live** — add `op.scores` to the participant fetch; in the leader/current-hole loop, replace `p.total`/`p.holes_played` with `deriveAgg(rowFor(p), p.total, p.holes_played)`.
- **season** — one bulk query `SELECT outing_id, user_id, guest_id, scores FROM tm_outing_participants WHERE outing_id = ANY($1)`; build a `(outing_id, key)→scores` map (key = `user_id` or `guest_id`); in the sort + aggregation use derived totals.
- **leagues/standings** — same bulk query over the league's event ids; pass a per-event row map into `rankParticipants` so stroke ranking uses derived `.total` and skins/stableford use derived `.scores`.
- **CSV** — add a guest-row lookup (`WHERE outing_id=$1 AND user_id IS NULL`) keyed by `guest_id`; dispatch row lookup on `sp.is_guest`. Totals already row-computed.

Where it's natural, factor a small local helper `aggFromRows(flag, scores, fallbackTotal, fallbackHoles)` rather than duplicating the derive logic.

## Verification (parity is everything)

- **Sandbox Postgres parity harness:** seed outings + rows + state (synced, and a deliberately-stale `state.total` case). For each reader's core computation, assert **row-derived output == state-derived output** when synced, and that row-derived uses the ROW value (not the stale state) when they differ. Include a guest and a withdrawn/no_show player.
- **Live beta parity:** with the flag OFF vs ON against the same real closed season/league, assert identical standings JSON (diff = empty). Only flip the prod flag once the diff is clean.
- **Gate:** `node --check` + client lint + build + server tests; audit-before-claim pass.

## Failure-mode register

| Risk | Mitigation |
|---|---|
| Row-derive changes a ranking vs today (parity break) | Dedicated flag + explicit row-vs-state parity test per reader before flipping prod |
| Guest dropped from season/leagues because guest rows have NULL user_id | Key the row lookup by `guest_id` for guest entries; keep iterating `state.participants` so the guest set is unchanged |
| Missing row (guest pre-flag, gap) silently zeroes a total | `deriveScoreTotals` falls back to `state.total` when no row |
| Closed-outing historical order changes | Closed `state.total` == final row total; re-sort yields the same order (verified) |
| Skins/stableford use `.scores` not `.total` | `rankParticipants` fed row-derived `.scores`, not just totals |
| Reader left on stale `state` after S7 | This IS the fix; S7 is gated on S5 being live + verified |
