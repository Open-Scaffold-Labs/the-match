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
