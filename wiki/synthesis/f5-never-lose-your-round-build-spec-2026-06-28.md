---
type: synthesis
created: 2026-06-28
updated: 2026-06-28
tags: [the-match, f5, scoring, data-model, optimistic-concurrency, offline, build-plan]
---

# F.5 — "Never Lose Your Round" build spec (staged, flag-gated)

*The single most expensive-to-change item in the schema (audit N3) and the clearest competitive wedge: no major golf app reliably avoids losing rounds — they use last-write-wins + a conflict toast; tournament platforms dodge it by forcing one scorer per group. None ship true optimistic-concurrency. This is the spec to do it right, in reversible stages, each shipped to `main` (dark behind a flag where it changes behavior) and device-tested before the next.*

Grounded in: a complete in-repo inventory of every score read/write site (this session) + implementation-pattern research (OCC, idempotency, offline sync). Sources in the session record.

## 0. The core problem (precise)

A score lives in TWO stores: the normalized row `tm_outing_participants` (`scores`, `total`, `score_version`) AND the denormalized blob `tm_outings.state.participants[]` (`total`, `holes_played`, `scores`, flags, group/team ids; **guests live ONLY here**). Every score write updates the row AND re-serializes the whole `state` blob; the leaderboard reads `total` from `state`. Two failure modes:
1. **Stale-state read** — if the `state` participant index lookup misses (documented string/number `findIndex` → -1 bug at `outings.js:864`), the row gets the score but `state.total` stays stale → wrong leaderboard.
2. **Lost update** — concurrent writers each read→mutate→rewrite the whole `state` blob; the second clobbers the first. Only matters for the **score-on-behalf** path (`/scores/host`); **self-scoring is single-writer and already safe** (you own your card).

## 1. Guiding principles (from research — avoid over-engineering)

- **Single source of truth = the rows.** `state` keeps only genuinely outing-level config (groups, teams, markers, no_show_policy, handicap_overrides, stableford_points, season) — never per-player scores.
- **OCC only where there are multiple writers.** Self-scoring (`PUT /scores`) stays last-write-wins. The version guard + conflict UI applies to the on-behalf path (`/scores/host`). Don't build merge UX for self-scoring.
- **Integer `version` column** (`score_version`, migration 036 — already added), `UPDATE … WHERE id=? AND score_version=?`; 0 rows → 409 with the current value. NOT `xmin`, NOT `updated_at` (clock skew).
- **Idempotency key generated at tap-time, stored ON the queued mutation**, so reconnect-replay and app-restart-replay can't double-apply. `(user_id, key)` unique table storing the response; 24–72h TTL.
- **Non-destructive conflict:** 409 returns both values; the append-only `tm_score_audit` table is already our event log (nothing is ever truly lost). No CRDTs.
- **Readers and writers must flip in lockstep.** The moment a write stops syncing `state`, every reader still trusting `state.total` goes stale. This is the #1 split-brain trap.

## 2. Split-brain traps the staging MUST respect (from the inventory)

1. Readers `GET /:code` & `/:code/public` read `scores` from the row but `total`/`holes_played` from `state` — fix readers before/with stopping state writes.
2. `friends-live`, `season/:season`, `leagues/:id/standings` rank **entirely** off `state.participants[].total` — they freeze at last-synced values the instant state writes stop. Must flip together.
3. **Guests are state-only** — cannot make rows the source of truth without first giving guests rows (touches audit/h2h/rounds which exclude guests via NOT NULL `user_id`).
4. Dead `PUT /:code/scores/marker` still writes `state` — must be updated or removed, or a stray/replayed call re-introduces divergence.
5. Offline queue carries no version — a write queued before a correction replays with no `score_version` and would silently drop or clobber. Define replay-vs-version semantics.
6. `/end` writes `result` from ROW order but the winner ceremony + standings sort from STATE — divergence at close means recorded results disagree with displayed standings.
7. `no_show` auto-set at `/end` is state-only while `result`/rounds are row-based.

## 3. Staged build (each stage: ship to `main`, dark behind a flag where it changes behavior, device-test, then enable)

**Stage 0 — scaffolding. ☑ DONE.** Migration `036` added `score_version` (additive, no-op). Append-only event log already exists (`tm_score_audit`).

**Stage 1 — make scores authoritative on READ + start versioning WRITES (this session).**
- 1a *(additive, no behavior change)*: increment `score_version` on every participant-row score write (`PUT /scores`, `/scores/host` app branch). Nothing reads it yet → zero risk; lays the OCC foundation.
- 1b *(flagged `SCORING_READ_FROM_ROWS`, default OFF)*: `GET /:code` and `/:code/public` derive `total` (= Σ scores) and `holes_played` (= count>0) from the authoritative row `scores` instead of `state.total`. Kills trap #1 for the main leaderboards. Off by default = zero beta change until Matt flips it in Vercel env and device-tests.
- → *verify:* sandbox Postgres — seed a row with correct scores + a deliberately-stale `state.total`; with flag on, endpoint returns row-derived total; `score_version` increments on write and scores/total are unchanged by the bump.

**Stage 2 — OCC on the on-behalf path** (flagged). `/scores/host` does `UPDATE … WHERE id=? AND score_version=?`; 0 rows → 409 with current value (client already handles `score_conflict` 409 + force-retry). Self-scoring untouched. → *verify:* simulated concurrent on-behalf writes → second gets 409, neither value lost (audit log has both); device-test a two-marker scenario.

**Stage 3 — idempotency + offline-queue hardening.** `tm_idempotency_keys (user_id, key)` table storing first response; key generated at tap-time and stored on the queued mutation (`offline-queue.js`); replay returns stored response. Queue carries `score_version`; define stale-replay = surface, don't silently drop. → *verify:* replay the same queued write twice → applied once; offline→reconnect drains in order with no double-apply.

**Stage 4 — guests get real rows** (migration + flag). Allow `tm_outing_participants` guest rows (nullable `user_id` + `is_guest` + `name`/`guest_id`); migrate `POST /:code/guests` and the guest score branches to write rows; update audit/h2h/rounds to handle guest rows (still excluded from handicap/h2h, but scored in rows). → *verify:* guest scores survive reload; existing guest data backfilled.

**Stage 5 — flip the remaining readers to row-derived** (with the flag): `friends-live`, `season`, `leagues/standings`, CSV exports drop the `state` fallback. → *verify:* standings match a row-computed reference; leagues skins/stableford rank correctly.

**Stage 6 — conflict UX + optional designated-scorer mode.** Multi-writer conflict prompt keeps both + lets the scorer pick; optional "one group scorer" default for league/tournament play (what reliable tournament platforms do). → *verify:* design-critique + device test.

**Stage 7 — cutover (irreversible step, last).** Stop writing scores into `state` entirely; `state` becomes config-only. Remove/neutralize the dead `/scores/marker` state write. Flip `SCORING_READ_FROM_ROWS` to default-on; retire the flag. → *verify on a real multi-player match (Matt):* no score loss, leaderboard correct, big close fast.

## 4. Progress checklist

- ☑ S0 `score_version` column (migration 036)
- ◐ S1a increment `score_version` on row score writes (additive)
- ◐ S1b read-derive `total`/`holes_played` from rows on `/:code` + `/public` (flag `SCORING_READ_FROM_ROWS`, default off)
- ☐ S2 OCC version-guard on `/scores/host` → 409-returns-current (flagged)
- ☐ S3 `tm_idempotency_keys` table + tap-time keys on the offline queue + queue carries version
- ☐ S4 guests → real `tm_outing_participants` rows (migration; audit/h2h/rounds updated)
- ☐ S5 flip `friends-live`, `season`, `leagues/standings`, CSV to row-derived
- ☐ S6 multi-writer conflict UX (keep-both) + optional designated-scorer mode
- ☐ S7 cutover: stop `state` score writes; neutralize dead `/scores/marker`; default flag on; retire flag
- ☐ Remove dead `net_total` column (vestigial) — opportunistic cleanup

## 5. Failure-mode register

| Risk | Mitigation |
|---|---|
| Reader left on stale `state.total` after writes stop | Readers flip in lockstep with writes (S1b, S5); flag gates the transition |
| Guest scores lost when rows become source of truth | Guests get rows (S4) BEFORE the cutover (S7) |
| Offline replay double-applies or silently drops | Idempotency key on the queued mutation (S3); replay returns stored response; stale-version replay surfaced not dropped |
| Over-engineering self-scoring | OCC/conflict UI only on the on-behalf path; self stays LWW |
| Dead `/scores/marker` re-introduces divergence | Updated/removed at S7 |
| Cutover corrupts in-flight outings | S7 is last, behind the proven flag, device-tested; `state` retained as fallback until proven |

## 6. Honest notes

F.5 is a multi-PR effort, not one change. Each stage is independently shippable and reversible; the only irreversible step (S7, stop writing `state`) is last and gated on a real-match device test. This spec deliberately does NOT rush the guest migration (S4) or the reader flips (S5) — getting those wrong is silent score loss, the exact thing F.5 exists to prevent.
