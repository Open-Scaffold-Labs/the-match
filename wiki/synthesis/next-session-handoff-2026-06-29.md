---
type: synthesis
created: 2026-06-29
updated: 2026-06-29
tags: [the-match, handoff, eagle-eye, visual-flow, accuracy]
---

# The Match — Next-Session Handoff (2026-06-29) → Eagle Eye accuracy + visual flow

Supersedes `next-session-handoff-2026-06-28.md`. Read this first, then the two live plans you'll be working from: **`eagle-eye-premium-plan-2026-06-23.md`** (the design plan / what "premium" means) and **`build-plan-bulletproof-2026-06-23.md`** (the master checklist + risk register + zero-cost stack). Both were updated 2026-06-29 to reflect F.5 complete.

## Where things stand (one paragraph)

**F.5 "never lose your round" is COMPLETE** — S1–S7 all live on the beta (`the-match-roan.vercel.app`, `main` auto-deploys): OCC on the on-behalf path, idempotent offline replay, guests as real rows, all readers row-derived, designated-scorer mode, and the S7 cutover (rows are the sole score store; `state` is config-only). Every stage is flag-gated + reversible and was verified against real Postgres, live prod, and a real-browser UI pass. Scoring **reliability** — one of the premium plan's pillars — is now best-in-class. **The remaining push is the layer this whole effort opened with and never finished: the user-facing VISUAL FLOW + ACCURACY POLISH of Eagle Eye (and the app).** The hero Eagle Eye instrument shipped (MapLibre, cinematic flyTo, arc gauge, glass HUD, plays-like, own-club arcs); what's missing is the foundation token/type/motion pass, the accuracy refinements on top of the GPS gate, and the app-wide polish/refactor.

## Pick up here — ranked

**1. Phase 0 — the "expensive in an afternoon" foundation pass (highest perceived-quality per hour; NONE done).** App-wide, low-risk, high-payoff. From the premium plan §Phase 0 + build-plan Phase 0:
   - Tabular numerals (`font-variant-numeric: tabular-nums`) on **every live number** — distances, scores, timers (stops numbers "dancing").
   - Real dark-elevation surfaces (lighter surface = higher elevation, not shadow) + layered hue-tinted shadows on light surfaces; new tokens in `client/src/design/tokens.css`.
   - Palette tells: never pure `#000`/`#FFF` text; desaturate dark-mode accents; verify AA contrast per elevation.
   - Motion discipline: animate only `transform`/`opacity`, 200ms ease-out default; springs for gesture moves.
   - Type system: one UI sans + one mono/tabular "instrument" face (free/OFL), single derived scale; the mono face becomes Eagle Eye's hero numerals.
   - ~8% SVG grain overlay on dark surfaces (kills flat-digital banding).
   → *verify: visual diff across tabs, contrast checks, 60fps, numbers don't reflow.*

**2. Eagle Eye ACCURACY polish (on top of the shipped GPS accuracy gate + NAIP imagery).** The shipped baseline: `coords.accuracy` gate suppresses yardage > ~10 m + "acquiring" state (build-plan 1.1), course geometry cached to Supabase (1.2), NAIP imagery replacing keyless ESRI (1.3), own-club distance arcs from real bag data (3.3), transparent plays-like with real 3DEP elevation (3.1). Refinements to build (from the earlier accuracy research + `audit-2026-06-27`):
   - **Graded GPS-confidence chip** — beyond the binary >10 m gate: a calm graded indicator (locked / good / acquiring with live ±m). Trust signal, NOT a marketing precision claim (see marketing stance below).
   - **Club-arc dispersion bands** — render own-club arcs as distribution bands (carry ± spread), not just single rings.
   - **Battery discipline + instant-on** — watchPosition/wake-lock tuning so a 4-hr round doesn't drain or OOM (risk #6); fast first-fix.
   - **Concentric yardage range-rings** — Phase 2.5's held item (pending a live-map clutter check). Decide + ship or drop.
   → *verify on a real phone outdoors: cold-start garbage never shows; arcs are true ground distance; battery/memory stable over a simulated round.*

**3. App-wide premium polish + the Eagle Eye refactor** (premium Phase 3 / build Phase 4):
   - Skeletons instead of "Loading…"; view-transition page morphs where supported.
   - Perf-as-polish: `content-visibility:auto` on long scorecards/history, RAIL budgets, optimistic score entry.
   - **Consolidate Eagle Eye's 190+ inline styles into a small token-based `<Sheet>`/HUD component set** — pays down the brittleness the design audit flagged; do it alongside the Phase 0 token work.

**4. Remaining leapfrog features (sequence by Matt's appetite):** 3.2 ad-free generous free tier (the strategic wedge — needs the free/paid line decided), 3.4 green slope + putt-line (needs a credible contour source), 3.6 clean AR distance overlay.

## Reusable tools this arc built (use them)

- **Sandbox-Postgres harness** — prove migrations + SQL against a real Postgres with zero prod impact. `/tmp/pgenv` persists across sandbox calls; processes don't, so start `pg_ctl` at the top of each call:
  `/tmp/pgenv/bin/pg_ctl -D /sessions/.../pgtest/data -o "-p 5433 -k <sock> -c listen_addresses=''" -l <log> start`, then `node` a script that `require`s the repo's real `server/src/db.js` with `PGHOST/PGPORT/PGUSER/PGDATABASE` env set. The S2–S7 verifies + the boot-the-Express-app HTTP e2e all used this.
- **Live-beta e2e via real test accounts** — sign up throwaway accounts through `/api/auth/signup`, drive the real prod endpoints, verify in the prod DB, then **DELETE all test data** (users `…@thematch.test`, the outing, idempotency keys). Patterns in this session's scripts. NOTE: signup is rate-limited ~3/min.
- **Claude-in-Chrome UI test** — drive the actual web app in a real browser (sign in, render the screen, `javascript_tool` to inspect localStorage / simulate offline by monkeypatching `fetch`). This is how the UI/offline layer was verified without a physical phone.
- **Prod ops, do-it-yourself** — `psql "$DATABASE_URL"` (from `~/the-match/.env`), the Vercel CLI (authed, `vercel env add` + `vercel --prod --yes`), and the harness are all available. Apply migrations, flip flags, redeploy yourself; don't hand safe/verifiable steps to Matt.

## Prod state right now (so you don't redo / are not surprised)

- **Vercel prod env flags all ON:** `SCORING_READ_FROM_ROWS`, `SCORING_OCC_ONBEHALF`, `SCORING_IDEMPOTENCY`, `SCORING_GUEST_ROWS`, `SCORING_AGG_READ_FROM_ROWS`, `SCORING_DESIGNATED`, `SCORING_STATE_WRITES_OFF` = `1`. Each is an independent reversible off-ramp (`vercel env rm … && vercel --prod`).
- **Migrations applied to prod:** through **038**. (036 score_version, 037 idempotency, 038 guest rows — 13 existing guests backfilled. 035 indexes also applied.) Migrations are append-only — next is `039`.
- `/health` green (`status:ok, db:true`). Marketing site URL: `the-match.openscaffoldlabs.com`; app/beta: `the-match-roan.vercel.app`.

## Standing rules (don't relearn the hard way)

- **Roll Call FIRST** (`roll-call` skill / `tools/limitless-preflight.sh`), then read `wiki/index.md` + the most recent `wiki/log.md` entry. Pinecone quota is exhausted (known yellow) — semantic search offline until reset.
- **Beta discipline:** `main` IS the test surface. Gate every push: `npm --prefix client run build` + `run lint` + `node --check` on changed server files + `npm test`. **Lint `no-undef` is a hard gate** — and the SERVER isn't covered by the client ESLint, so run `eslint --no-config-lookup` with a `no-undef` flat config on changed server files (a real scope bug got caught that way this arc; `node --check` only catches syntax).
- **Framing & recommendation check (anti-pattern #26):** before framing anything as "normal / for now / future upgrade / MVP then iterate / harden later," run the standard-contradiction check — build the higher bar; don't dress a shortcut as normal.
- **audit-before-claim every claim;** verify against the artifact (screenshot/DB/test), hedge < 95%. This arc it caught a real `/end` split-brain bug AND a self-misread ("2028" date) — keep it sharp. For Eagle Eye, use **design-critique** on the rendered UI too.
- **Marketing accuracy stance (Matt):** never claim "laser"/"laser-grade," never advertise a precision margin. Lead with strengths (instant GPS to F/C/B, whole-hole view, no rangefinder). The in-app ±m confidence chip is a UX trust signal, not a marketing claim.
- **Ship behind a flag, verify on sandbox + prod, then enable.** Migrations apply by hand via `psql`. Don't push broken code to `main` (it's the beta).

## Outstanding NON-Eagle-Eye items (parked, not forgotten)

- **POST-LAUNCH #25 — native iOS shell round** (the only F.5 residual; confidence check, not a gate). Also #24 full-bleed viewport (native shell), #26 native sentinel.
- **Track F security:** F.7 JWT revocation (`tm_users.token_version`), F.8 PIN brute-force lockout — specced, not built.
- **Track F native shell:** F.9 Info.plist usage strings (crash/rejection without them), F.10 native `window.__TM_NATIVE__` + `WKUIDelegate`.
- **Operational/cost:** migrate the-match onto the org's Vercel Pro + Supabase Pro; confirm attribution surface (OSM + vector tiles + fonts + NAIP); satellite strategy (US NAIP free; worldwide deferred).

## Key files (Eagle Eye surfaces)

- `client/src/pages/EagleEye.jsx` — the hero rangefinder surface (190+ inline styles — refactor target).
- `client/src/pages/HoleMapGL.jsx` — the MapLibre GL hole map (NAIP base + branded overlays, flyTo, arc gauge, puck, own-club arcs, plays-like).
- `client/src/design/tokens.css` — design tokens (Phase 0 lives here).
- `client/src/lib/playsLike*.js` / `client/src/lib/handicapClient.js` — accuracy math already shipped.
- Specs: `eagle-eye-premium-plan-2026-06-23.md`, `build-plan-bulletproof-2026-06-23.md`, `eagle-eye-next-level-plan-2026-06-06.md`, `playslike-3.1-build-spec-2026-06-25.md`, `own-club-arcs-3.3-build-spec-2026-06-25.md`, `audit-2026-06-27.md`.

**First decision for the next session to get from Matt:** Phase 0 foundation pass alone (fast, whole-app lift), or Phase 0 + the accuracy-polish slice together? Recommend Phase 0 first — it derisks and visibly lifts everything, and the token/type system is the substrate the accuracy chips + dispersion bands render on.
