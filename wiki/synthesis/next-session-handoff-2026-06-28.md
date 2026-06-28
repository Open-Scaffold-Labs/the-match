---
type: synthesis
created: 2026-06-28
updated: 2026-06-28
tags: [the-match, handoff, f5, foundation-lock]
---

# The Match — Next-Session Handoff (2026-06-28)

Supersedes `next-session-handoff-2026-06-27.md`. Read this first, then the live plans:
`f5-never-lose-your-round-build-spec-2026-06-28.md` (the current build),
`build-plan-bulletproof-2026-06-23.md` (Track F + the master checklist), and
`audit-2026-06-27.md` (the findings these trace back to).

## Where things stand (one paragraph)

A long Foundation-Lock session. The beta (`main` → Vercel, `the-match-roan.vercel.app`) is green and stable. Shipped and verified this session: the whole Track F "slice 1" (`/api/v1` versioning, CI hard lint gate + a real test job, serverless pool fix, native-shell sentinel, two Eagle Eye bug fixes), the **F.6 `/end` batching** fix (O(N²)→2 queries, proven byte-identical to the old loop on a real Postgres), a **repair of the broken migration chain** (`004_tm_games.sql` — a fresh rebuild now replays 37/37), and **F.5 Stage 1** ("never lose your round" foundation). Migrations `035` + `036` are **applied to prod**, and **S1b is live** on the beta (`SCORING_READ_FROM_ROWS=1`). Also hardened the process itself: anti-pattern #26 + an active "Framing & recommendation check" in both CLAUDE.md files.

## Pick up here — ranked

1. **F.5 S2 + S3 — the core of "never lose your round."** S2: optimistic-concurrency guard on the score-on-behalf path (`PUT /:code/scores/host`) — `UPDATE … WHERE id=? AND score_version=?`, 0 rows → 409 with the current value (client already handles `score_conflict` 409 + force-retry). S3: `tm_idempotency_keys (user_id, key)` table + generate the key at tap-time and store it ON the offline-queue mutation (`client/src/lib/offline-queue.js`) so reconnect/restart replays can't double-apply; queue carries `score_version`. Both ship behind a flag, verified on the sandbox-Postgres harness + against prod data, and the parts a player sees get a real-match device check by Matt. Full staged detail (S2–S7) in `f5-never-lose-your-round-build-spec-2026-06-28.md`.
2. **Then F.5 S4–S7** in order: guests → real `tm_outing_participants` rows (migration; audit/h2h/rounds updated) → flip the remaining readers (`friends-live`, `season`, `leagues/standings`, CSV) to row-derived → conflict UX + optional designated-scorer mode → **cutover** (stop writing `state` scores; default the flag on; retire it). The cutover (S7) is the only irreversible step — it's last and gated on a real-match device test.
3. **Or pivot to the market-winning layer** (Eagle Eye Phase-0 design tokens + accuracy upgrades from `audit-2026-06-27`/research: graded GPS confidence, distribution-band club arcs, battery discipline, instant-on). Foundational F.5 is higher value for "build it right," but this is what users feel.

## Reusable tool this session created (use it)

**Sandbox-Postgres verification harness.** You can prove migrations + SQL changes against a real Postgres without touching prod:
```
cd /tmp && curl -Ls https://micro.mamba.pm/api/micromamba/linux-aarch64/latest | tar -xvj bin/micromamba
MAMBA_ROOT_PREFIX=/tmp/mamba /tmp/bin/micromamba create -y -p /tmp/pgenv -c conda-forge postgresql
/tmp/pgenv/bin/initdb -D /tmp/pgdata -U postgres --auth=trust
/tmp/pgenv/bin/pg_ctl -D /tmp/pgdata -o "-p 5433 -k /tmp/pgsock -c listen_addresses=''" start
```
Then create a DB and `psql -f` the migrations. This is how F.6 parity and the 37/37 migration replay were proven. (`/tmp` persists across sandbox calls but processes don't — restart `pg_ctl` at the top of each call.)

## Prod state changes made this session (so you don't redo / are not surprised)

- **Migrations applied to prod:** `035` (tm_outings status/host_id indexes), `036` (tm_outing_participants.score_version). Both additive/`IF NOT EXISTS`. `004_tm_games.sql` is a **no-op on prod** (table already exists) — only matters for fresh rebuilds; do NOT "apply" it expecting a change.
- **Vercel prod env:** `SCORING_READ_FROM_ROWS=1` added; redeployed; S1b verified live (`/api/outings/8G49/public` totals = Σ row scores). Reversible: remove the env var + redeploy.
- **Pending in prod:** nothing from this session. Future migrations still apply by hand via `psql "$DATABASE_URL" -f migrations/0NN_*.sql`.

## Standing rules (don't relearn the hard way)

- **Roll Call first** (`roll-call` skill / `tools/limitless-preflight.sh`), then read `wiki/index.md` + the most recent `wiki/log.md` entry. Pinecone quota is exhausted (known yellow) — semantic search is offline until reset.
- **Beta discipline:** `main` IS the test surface. Build-verified code goes to `main`. Gate = `npm --prefix client run build` + `run lint` + `node --check` on changed server files + the relevant test runner. Lint (`no-undef`) is now a hard CI gate; the CI `test` job runs vitest + `node --test` math + client units.
- **Framing & recommendation check (NEW, active):** before framing any decision as "normal / for now / future upgrade / simplest thing that ships / MVP then iterate / harden later," run the standard-contradiction check (CLAUDE.md). Don't excuse a shortcut as normal — build the higher bar. (Anti-pattern #26.)
- **Do it yourself:** you have `psql` to prod, the Vercel CLI (authed), and the sandbox-Postgres harness — apply migrations, flip flags, test against prod data, and redeploy yourself rather than handing safe/verifiable steps to Matt.
- **Migrations are append-only** — never edit a numbered file. `004_tm_games.sql` shares the `004_` prefix deliberately to sort before `005`.
- **F.5 only over-engineers where there are multiple writers:** self-scoring stays last-write-wins; OCC/conflict UX is for the on-behalf path only.
- **Known: the-match's `wiki/synthesis/claude-anti-patterns.md` is a stale fork** (stops at #13, missing #14–25). Matt chose to leave it — the OpenScaffold master (`obsidian` vault) is the canonical one.

## Key files (this session's surfaces)

- `server/src/routes/outings.js` — F.6 batched `/end`; F.5 S1a version bump + S1b read-derive (`deriveScoreTotals`, `SCORING_READ_FROM_ROWS`).
- `server/src/lib/match-close.js` (+ `server/test/match-close.test.js`) — pure pairing/result helpers for `/end`, unit-tested.
- `server/src/index.js` — `/api/v1` dual-mount; `server/src/db.js` — pool; `server/vitest.config.mjs` — scoped suites.
- `client/src/lib/api.js` — `/api/*`→`/api/v1/*` rewrite; `client/src/lib/push.js` — `isNativeShell()`.
- `migrations/004_tm_games.sql` (repair), `035_*` (indexes), `036_*` (score_version).
- Specs: `f5-never-lose-your-round-build-spec-2026-06-28.md`, `foundation-lock-build-spec-2026-06-27.md`, `audit-2026-06-27.md`.
