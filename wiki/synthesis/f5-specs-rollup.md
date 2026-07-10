---
type: synthesis
created: 2026-07-10
updated: 2026-07-10
tags: [the-match, f5, scoring, rollup]
---

# F.5 Specs Rollup — single NotebookLM source for the five COMPLETE F.5 build specs

One combined source so the five F.5 "never lose your round" sub-specs stop
consuming individual slots against the 50-source cap (2026-07-10; same pattern
as [[synthesis/handoffs-rollup]]). F.5 is COMPLETE — all 7 stages SHIPPED + LIVE
on the beta (2026-06-29); S7 cutover live, every SCORING_* flag an independent
off-ramp. Individual spec files stay in the repo as the primary read path
(excluded from notebook routing via manifest exclude_paths "wiki/synthesis/f5-");
this rollup syncs instead. Regenerate if any f5-*.md is ever edited.



# [COMPLETE] f5-never-lose-your-round-build-spec-2026-06-28.md

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


# [COMPLETE] f5-s2-s3-build-spec-2026-06-28.md

---
type: synthesis
created: 2026-06-28
updated: 2026-06-28
tags: [the-match, f5, scoring, occ, idempotency, offline, build-plan, s2, s3]
---

# F.5 S2 + S3 — Detailed build spec ("never lose your round", the multi-writer core)

*Sub-spec of `f5-never-lose-your-round-build-spec-2026-06-28.md`. Grounded in a full read of the live code (`/scores`, `/scores/host`, `offline-queue.js`, `LiveOuting.saveScore`, `db.js`) + two research passes: (1) how the most-used golf apps handle group scoring/offline/conflict, (2) idempotency/OCC/offline-replay engineering best practice. Sources in the session record.*

## The competitive thesis (why this is the wedge)

Market research finding, stated plainly: **no major golf app reliably solves multi-device score conflict, and the silent lost round is the single most-repeated complaint across the entire category.** The field's behavior:

- The conflict-when-two-people-edit-the-same-score problem is **unsolved** across the field — most apps do last-write-wins with no signal; tournament platforms dodge it by forcing one scorer per group.
- The most damaging, most-repeated complaint everywhere is **scores silently lost** (usually a fragile watch→phone handoff) and **"entry didn't take."**
- **Nobody ships a good passive per-entry "saved / syncing / offline-queued" indicator** — a clear, open gap.
- True optimistic-concurrency with a real conflict-resolution path is shipped by **none** of them.

S2 + S3 are precisely the two mechanisms that close that gap: **OCC with a real, human conflict prompt** (S2) and **idempotent, never-double-applied offline replay** (S3). If we land these cleanly, scoring reliability becomes a defensible "we do the thing the whole category gets wrong" claim.

## What's already true in the code (grounding — don't rebuild)

- `score_version INTEGER` exists on `tm_outing_participants` (migration 036, applied to prod). Both score-write paths already `score_version = score_version + 1` on every write (S1a). **Nothing reads it yet.**
- S1b is **live on beta** (`SCORING_READ_FROM_ROWS=1`): `/:code` and `/:code/public` derive `total`/`holes_played` from the row `scores`, not `state.total`. So the main leaderboards already read authoritative rows.
- `/scores/host` already has a **per-hole, value-based** conflict guard: `!force && !isHost && !isSelfEdit && oldScore>0 && oldScore!==score` → `409 score_conflict` with `existing_score`. The client (`LiveOuting.saveScore`) already handles that 409 with a styled prompt and a `force:true` retry.
- `offline-queue.js` enqueues `{url, method, body, queuedAt}`, drains strict-FIFO, attaches token at replay time, and already **does not** auto-force-retry 409s (it surfaces drops). **No idempotency key today.**
- **`db.js` has no transaction helper** — every `db.query` uses a fresh pooled connection. Prod points at the Supabase pooler. A single-client `BEGIN…COMMIT` transaction helper must be added for S3's atomic claim+write+response.

## The one design decision that matters most (and where I deviate from the parent spec's wording)

The parent spec says S2 = "`UPDATE … WHERE id=? AND score_version=?`; 0 rows → 409." Taken literally with a **client-supplied** row version, that is **wrong for our data model** and would create false conflicts:

> A participant's 18 hole scores live in **one `scores` JSONB array** under **one `score_version`**. If a host bulk-enters a foursome while a marker simultaneously enters one player's hole, both read `version = N`, both write — under naive client-version CAS the second gets a 409 **even though they edited different holes and nothing was actually lost.** That is an annoying, incorrect conflict.

**Bulletproof design instead — serialize, then apply the existing per-hole value guard:**

```
db.tx(client => {
  BEGIN
  row = SELECT * FROM tm_outing_participants
        WHERE outing_id=$o AND user_id=$u
        FOR UPDATE                      -- serializes concurrent on-behalf writers
  -- now we hold the latest committed scores, incl. any concurrent writer's other-hole edit
  oldScore = row.scores[hole]
  if (!force && !isHost && !isSelfEdit && oldScore>0 && oldScore!==score)
      → 409 score_conflict {existing_score, current_version: row.score_version,
                            last_written_by, updated_at}   -- ROLLBACK
  scores = mutate(row.scores, hole, score)
  UPDATE … SET scores, total, score_version = score_version + 1
        WHERE id=$id AND score_version=$rowVersion          -- belt: rowVersion read in-txn, always matches
  -- sync state blob in the SAME txn (state+row commit atomically)
  COMMIT
})
```

Why this is the higher bar, not a shortcut:

- **`FOR UPDATE` is what actually prevents the lost update.** The second writer blocks until the first commits, then reads the first's committed array (including their different-hole edit) before mutating its own hole. **Different-hole concurrent edits commute correctly** — no false conflict.
- **Same-hole, different-value** concurrent edits: the second writer reads the first's value as `oldScore`, and the *existing per-hole value guard* fires correctly ("hole 7 already has 5") — the right granularity, better than a whole-row version mismatch.
- **`score_version` is still used**: incremented in the same `UPDATE`, and **returned** in the 409 so the client reconciles without a second round-trip. The `AND score_version=$rowVersion` clause is a belt-and-suspenders CAS (the version was read inside the same txn under the lock, so it matches; if it somehow doesn't, we 409 rather than clobber).
- **String-vs-int trap avoided**: the version comparison lives in the bound SQL parameter (`AND score_version = $n`), never in JS (`"5" !== 5`) — the exact bug class documented in the Hub's CLAUDE.md.

Guests are state-only (no row, no `score_version`) until S4 — they keep the value-based guard only. Self-scoring (`/scores`) stays single-writer last-write-wins, untouched.

**Honest residual:** `FOR UPDATE` adds a short row lock and requires a real transaction (hence `db.tx`). Under the Supabase pooler this is safe **only if the whole transaction runs on one checked-out client** — the helper enforces that. We use a row lock (`FOR UPDATE`), **not** session-level advisory locks (those leak through a pooler). Read Committed isolation is sufficient; no Serializable, no retry-on-40001 needed.

## S2 — build steps

1. **`db.tx(fn)` helper in `db.js`** — checkout `pool.connect()`, `BEGIN`, run `fn(client)`, `COMMIT`/`ROLLBACK` on throw, always `release()`. Additive; nothing else changes.
2. **`/scores/host` app-user branch** → run the read-modify-write inside `db.tx` with `SELECT … FOR UPDATE`, version-guarded `UPDATE`, and the `state` sync **inside the same txn**. Behind flag **`SCORING_OCC_ONBEHALF`** (default off) so beta is unchanged until Matt flips + device-tests. Old path stays as the flag-off branch (reversible).
3. **Enrich the 409**: include `current_version`, `last_written_by` (resolve the name from `state.participants`/users), `updated_at`. Additive — safe even with the flag off.
4. **Client value-aware reconcile** (`saveScore`): on `409 score_conflict`, if `existing_score === incoming` → **silently converge** (adopt, no prompt); only prompt on a true difference, and show **who/when** ("Dale entered 5 on hole 7 just now — Keep mine / Keep theirs"). This is the field-beating UX.

### S2 verification (→ before enabling the flag)
- Sandbox-Postgres harness, two concurrent on-behalf writes:
  - same player, **different holes** → both land, neither lost (**the lost-update test**).
  - same player, **same hole, different value** → exactly one `UPDATE` (`rowCount===1`), the other gets 409 with current value + writer name; `tm_score_audit` has both.
- Unit-test the pure merge/conflict decision helper (`server/test/`).
- Device test (Matt): a real two-marker foursome.

## S3 — build steps

### Server
1. **Migration `037_tm_idempotency_keys.sql`** (next number; append-only):
   ```sql
   CREATE TABLE tm_idempotency_keys (
     id              BIGSERIAL   PRIMARY KEY,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     locked_at       TIMESTAMPTZ,
     user_id         BIGINT      NOT NULL,
     idempotency_key TEXT        NOT NULL CHECK (char_length(idempotency_key) <= 100),
     request_method  TEXT        NOT NULL,
     request_path    TEXT        NOT NULL,
     request_hash    TEXT        NOT NULL,          -- sha256 of canonical body
     recovery_point  TEXT        NOT NULL DEFAULT 'started',  -- 'started' | 'finished'
     response_code   INT,
     response_body   JSONB
   );
   CREATE UNIQUE INDEX tm_idempotency_keys_user_key ON tm_idempotency_keys (user_id, idempotency_key);
   CREATE INDEX tm_idempotency_keys_created_at ON tm_idempotency_keys (created_at);  -- cleanup only
   ```
2. **Atomic claim + score write + response store in ONE transaction** (research's #1 leverage point — kills the entire phantom-write class). Order inside `db.tx`: claim key (`INSERT … ON CONFLICT DO NOTHING RETURNING`) → if first, do the S2 version-guarded write → store `response_code`/`response_body`, set `recovery_point='finished'`, clear `locked_at` → COMMIT. If the key already exists: `finished` → replay stored response + header `Idempotent-Replayed: true`; in-flight (`locked_at` fresh) → `409` "request in progress"; **request_hash mismatch → `422`** (same key, different body). Reclaim a stale lock (crashed handler) via `locked_at` age.
3. **Scope**: idempotency applies to the two score writes only (`/scores`, `/scores/host`). Not a blanket middleware on every route — minimal surface.
4. **Cleanup**: opportunistic `DELETE WHERE created_at < now() - interval '7 days'` (golf phones go offline for days — **correctness must not depend on TTL**; the window only bounds storage). 7d not Stripe's 24h.

### Client (`offline-queue.js` + `saveScore`)
5. **Generate `crypto.randomUUID()` at the user action** (in `saveScore`, before the first attempt) and attach it to **both** the immediate fetch (`Idempotency-Key` header) **and** the enqueued item. This closes the most dangerous hole: *first attempt's write commits server-side but the ack is lost → client treats it as a network error → enqueues → replay double-applies.* Same key on both = server dedupes it.
6. **Force-retry uses a NEW key** — it's a different body (`force:true`); reusing the key would (correctly) 422. A user-confirmed overwrite is a new logical action.
7. **Queue carries the key**; replay re-sends the same header.
8. **Full jitter on the drain trigger** — the 30s `setInterval` ping and the `online`-event drain get small randomized delay so a clubhouse of phones reconnecting at once doesn't synchronize into a server wave. (Each client already drains its own queue strict-FIFO and sequentially, so per-client load is already bounded; jitter handles the cross-client herd.)

### Deliberate scope decisions (named, not hand-waved)
- **No server-side monotonic per-client `seq` counter.** Ordering is already guaranteed by the strict-FIFO single-client queue array; dedup is the idempotency key. A `seq` counter only buys cross-tab/cross-device same-user concurrent queues, which isn't our model (scores are per-user, one active device per session). Adding it would be complexity without a covered failure mode. If we ever add multi-device same-user live editing, revisit.
- **No background-sync API reliance** — WKWebView (our iOS shell) has limited/no support. The real replay triggers are `online` + `visibilitychange` + (later) the native shell's reachability callback. Background Sync is progressive enhancement only.

### S3 verification (→ before enabling)
- Replay same key+body twice → applied once; second returns stored response + `Idempotent-Replayed: true`.
- Same key + **different** body → `422` (not a silent cached return, not applying the new body).
- Two concurrent requests, same key → one executes, the other `409` in-progress (not a raw 500 unique-violation).
- Crash after DB commit, before ack → retry returns stored response, **no double side-effect** (score row, state, audit, achievements all covered because replay short-circuits before doing work).
- Offline → reconnect drains strict-FIFO with **no double-apply**.
- Expired-key replay within the 7d window still dedupes.
- Client unit: exactly one key per user action, shared between immediate + queued copy; force-retry uses a fresh key.

## Failure-mode register (S2 + S3)

| Risk | Mitigation |
|---|---|
| Naive row-version CAS false-conflicts different-hole concurrent edits | `FOR UPDATE` serialization + per-hole value guard; row version is a belt, not the gate |
| Lost update on the `scores` array (concurrent RMW) | `SELECT … FOR UPDATE` in `db.tx` — second writer reads first's committed array |
| Ack lost → enqueue → double-apply | Idempotency key generated at tap-time, shared by immediate attempt + queued copy |
| Crash mid-handler leaves "finished" key for work that never happened | Claim + write + response-store in ONE transaction (commit/abort together) |
| Same key, different body returns wrong cached response | Store `request_hash`; mismatch → 422 before any work |
| Offline longer than TTL re-processes everything | Correctness independent of TTL; 7d retention sized to real offline windows |
| Clubhouse reconnect storm | Full jitter on drain triggers; per-client FIFO already bounds per-client load |
| Pooler breaks the transaction | `db.tx` runs the whole txn on one checked-out client; row lock not session advisory lock |
| String-vs-int version mismatch (`"5"!==5`) | Version comparison only in bound SQL param `AND score_version=$n` |
| Self-scoring over-engineered | OCC/conflict UI on the on-behalf path only; self stays LWW |

## Shipping & flags

- Each stage ships to `main` (beta IS the test surface) only after **build + lint + `node --check` + the test runners** pass.
- **S2** behind `SCORING_OCC_ONBEHALF` (default off). Enriched-409 fields + client value-aware converge are additive/safe.
- **S3** is dark until the client sends `Idempotency-Key`; ship server (037 + handler) first, then the client change. Optionally gate the client header behind a build constant for one beta cycle.
- Irreversible cutover (stop writing `state` scores) is **not** in S2/S3 — that's S7, last, gated on a real-match device test.

## Open question for Matt (one)

S2's enriched conflict prompt ("Dale entered 5 just now — Keep mine / Keep theirs") is the field-beating UX, but it's the one place this touches **visual flow** mid-round. Want me to (a) keep it minimal — a one-line inline chip with two buttons, or (b) design it as a small styled sheet consistent with the existing `conflictPrompt` modal? Default if you don't weigh in: **(a) inline chip**, lowest friction during a round.


# [COMPLETE] f5-s4-guest-rows-build-spec-2026-06-29.md

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


# [COMPLETE] f5-s5-reader-flip-build-spec-2026-06-29.md

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


# [COMPLETE] f5-s6-designated-scorer-build-spec-2026-06-29.md

---
type: synthesis
created: 2026-06-29
updated: 2026-06-29
tags: [the-match, f5, scoring, designated-scorer, conflict-ux, build-plan, s6]
---

# F.5 S6 — Designated-scorer mode + conflict-UX polish (build spec)

*Grounded in the existing code (markers system + permission gate + S2 conflict chip + client `isMarkerFor`/`canEdit`) and market research on how the field handles group scoring. Sources in the session record.*

## Strategic frame (what the research says to beat)

The field's designated-scorer is **implicit** (whoever holds the code / created the round). Three whitespaces nobody fills well:
1. **No visible "you're scoring for this group" indicator** — the #1 unspoken confusion.
2. **No real mid-round scorer hand-off** — apps degrade to "let everyone write," which causes conflicts.
3. **No explicit conflict reconciliation** — the best incumbent (TheGrint) does silent last-write-wins.

The Match already ships #3 (the S2 inline chip beats the whole field) and already has the plumbing for designated scoring (`state.markers`, `PUT /:code/markers`, marker-aware gate, client `isMarkerFor`). S6 turns that plumbing into a real *enforced mode* and fills #1 and #2.

## What already exists (don't rebuild)
- `state.markers = [{ marker_id, member_ids[] }]`; host-only `PUT /:code/markers`; assignment UI in Commissioner.jsx; client `isMarkerFor(user,target)` + `isMarker`.
- `/scores/host` gate = `isHost || isExplicitMarker || isSameGroup`. **Markers only ADD permission today** — the same-group bypass means anyone in the foursome can already score anyone, so markers don't *restrict* anything.
- Client already gates editing OTHERS by `canEdit = isHost || isMarkerFor` — so the same-group bypass is a server-side gap, not a client affordance.
- S2 conflict chip handles scorer-vs-self divergence (names who entered, Keep mine / Keep theirs, silent converge on equal).

## Decision (Matt): non-scorers CAN still self-score
Designated mode restricts scoring OTHERS to host + assigned scorer; every player always keeps their own card via `PUT /:code/scores` (untouched). A scorer-vs-self conflict on the same player reconciles via the S2 chip. Nobody is ever locked out of fixing their own score.

## Build

### Server (flag `SCORING_DESIGNATED`, default off)
1. `PUT /:code/scoring-mode` (host-only) → `state.scoring_mode = 'open' | 'designated'` (default absent = `'open'`).
2. `/scores/host` gate: when `SCORING_DESIGNATED && state.scoring_mode === 'designated'`, permission becomes `isHost || isExplicitMarker` — **drop the `isSameGroup` bypass**. Otherwise unchanged. With the flag off, `scoring_mode` is ignored entirely ⇒ current behavior everywhere. Per-outing opt-in + global flag = double safety, fully reversible.
3. The self path (`PUT /:code/scores`) is NOT touched — players always self-score.

### Client (LiveOuting.jsx + Commissioner.jsx)
4. **Host mode toggle** in Manage/Groups: "Anyone in group" vs "Designated scorer". Choosing designated surfaces the existing marker-assignment UI to pick a scorer per group.
5. **"You're scoring for this group" banner** — shown to a designated scorer (designated mode + I'm a marker). The whitespace differentiator.
6. **Scorer badge** on the scorecard/leaderboard next to the group's scorer.
7. **Mid-round hand-off** — "Make X the scorer" reassigns the marker via the existing `PUT /:code/markers`. The dead-phone fix nobody ships.
8. Native-feel: ≥44px targets, safe-area aware, on-brand (Augusta-night/fairway/trophy-gold), 60fps, no broken empty states.

## What S6 deliberately does NOT do
- Does NOT change default behavior (open mode = today; designated is opt-in + flag-gated).
- Does NOT lock self-scoring (Matt's decision).
- Does NOT touch the dead `/scores/marker` endpoint (S7 removes it).
- Does NOT add attestation/certification (a later, separate feature if wanted).

## Verification plan
- **Sandbox Postgres / HTTP:** in designated mode, a same-group non-marker is **blocked (403)** from scoring another player; host + assigned marker **succeed**; self-score via `/scores` always succeeds; with the flag off OR mode 'open', same-group scoring works exactly as today (no regression). Hand-off (reassign marker) flips who can score.
- **Live beta e2e** with real accounts (host + scorer + non-scorer), then clean up.
- **design-critique skill** on the assign-scorer flow + banner/badge (hierarchy, the "who's scoring" clarity, tap targets, empty/edge states).
- **audit-before-claim** pass; gate (`node --check` + lint + tests); ship behind flag; docs.

## Failure-mode register

| Risk | Mitigation |
|---|---|
| Designated gate locks everyone out (no marker assigned for a group) | Host can ALWAYS score; client prompts host to assign a scorer when designated + a group has none |
| Default behavior changes / casual outings break | `scoring_mode` defaults 'open'; global `SCORING_DESIGNATED` flag gates enforcement; both off ⇒ identical to today |
| Player can't fix their own score | Self path untouched — every player always self-scores |
| Scorer's phone dies, group stuck | Hand-off action reassigns the scorer (host or — optional — group can) |
| Two people (scorer + self) enter the same hole | S2 conflict chip reconciles (names who, Keep mine/theirs, silent converge on equal) |
| Stale marker after group changes | Markers keyed by user_id; reassign via existing endpoint; host owns it |
| Confusion about who's scoring | Visible banner + badge (the research's #1 gap) |
