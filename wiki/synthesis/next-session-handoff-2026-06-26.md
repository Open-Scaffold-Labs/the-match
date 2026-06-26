---
type: synthesis
created: 2026-06-26
updated: 2026-06-26
tags: [the-match, handoff, roadmap]
---

# The Match — Next-Session Handoff (2026-06-26)

*Supersedes `next-session-handoff-2026-06-24.md`. Read this first, then the two living plans: `build-plan-bulletproof-2026-06-23.md` (the checklist) and `eagle-eye-premium-plan-2026-06-23.md` (the design thesis). Both updated 2026-06-26 to reflect what shipped.*

## Where things stand (one paragraph)

Eagle Eye's hero-instrument work (Phase 1 + 2) is done and device-verified: MapLibre GL is the sole hole renderer, NAIP imagery, cinematic flyTo, the 270° arc + odometer distance instrument, glass HUD, true-ground yardage arcs + glide puck. On the leapfrog track, **3.1 transparent adjustable plays-like** and **3.3 own-club distance arcs** shipped. A full **handicap & scoring-accuracy track** (not in the original plan) also shipped: gender foundation, gender-correct tee ratings, Course Handicap for match strokes, per-player gender ratings, and a **WHS-faithful index rewrite** — capped this session by the **9-hole corruption guard** and **making solo rounds handicap identically to outing rounds**. The beta (`main` → Vercel) is green; the handicap engine is WHS-accurate end to end.

## What shipped this session (2026-06-26)

- **9-hole corruption guard** (`server/src/lib/handicap.js`, `roundDifferential`): sub-18 rounds are excluded from the 18-hole Index. They were previously corrupting it — a 9-hole gross differenced against an 18-hole rating produced a hugely negative differential that crashed the Index. Test: `server/src/lib/__tests__/ninehole-solo-si.test.cjs`.
- **Solo rounds = any round** (migration **033** `tm_rounds.hole_handicaps`; `rounds.js`; `ActiveRound.jsx`; handicap query COALESCE): solo rounds now capture the picked tee's Course/Slope rating (were hardcoded null → par-only differential) AND per-hole Stroke Index (was missing → AGS fell back to 1..18). A solo round on a rated course now computes the same USGA differential + real-SI net-double-bogey as an outing round.
- Commits: `fcee445` (fix) + `093895f` (notebooklm state). Migration 033 applied + verified. build + lint + node --check clean. NotebookLM verified (verify_failed: 0). Preflight green (14/0).

## Pick up next — ranked

1. ~~**H.6 — WHS 9-hole counting (expected-9).**~~ **DONE 2026-06-26 (`6e85608`).** 9-hole rounds now COUNT, converted to one 18-hole differential via the WHS expected-score method (Rule 5.1b). 9-hole CR estimated as ½·18-hole CR, so no new data dependency. 11 assertions. **The handicap engine is now WHS-complete.** (Only labelled estimate left: the proprietary GHIN expected-score table, which no standalone app can match exactly.)

2. ~~**Desktop leagues/commissioner layout.**~~ **DONE 2026-06-26 (`0d2045e` + `981007d`).** The Leagues tab breaks out of the 430px frame on desktop (`useIsDesktop` in `client/src/lib/useViewport.js`): `LeaguesHub` centers + grids the cards, `LeagueDetail` centers hero/tabs/content. AND the live-event commissioner console (`CommissionerPanel`/`GroupSetup`/`TeamSetup`) is now a centered desktop modal with the 18-hole score-edit grid in one row per player (verified via harness). Mobile + every other tab + the iOS app untouched.

3. **Next Phase-3 leapfrog — Matt's pick (3.5 now shipped):** ~~3.5 data→practice loop~~ **DONE (`6e85608`/`b574ee8`)** — `lib/practice.js` + `GET /api/practice` + `Practice.jsx` overlay off a profile "Practice Plan" card. Remaining: **3.2** ad-free generous free tier · **3.4** green slope + putt-line (needs a credible contour data source) · **3.6** clean AR distance overlay.

4. **Operational / pre-launch (not code):** migrate the-match onto the org's existing Vercel Pro + Supabase Pro (off free tiers); confirm attribution surface (OSM + vector tiles + fonts + NAIP); hold the marketing accuracy stance (never claim "laser"/precision margins).

## Standing rules for next session (don't relearn the hard way)

- **Roll Call first** (`roll-call` skill / `tools/limitless-preflight.sh`), then read `wiki/index.md` + the most recent `wiki/log.md` entry.
- **Beta discipline:** `main` IS the test surface — build-verified feature code goes to `main`. The gate is **build AND lint** (`npm --prefix client run build` + `run lint` + `node --check` on changed server files). Lint (`no-undef`) catches the ReferenceError-class scope bugs a clean `vite build` will happily ship.
- **Migrations** are append-only, applied by hand via `psql "$DATABASE_URL" -f migrations/0NN_*.sql` (now through 033).
- **Mobile-first** everywhere EXCEPT leagues/commissioner surfaces (desktop too).
- **Handicap engine is the single source of truth:** `maybeUpdateUserHandicap` writes the persisted index; `stats.js` reads it (never recompute divergently).

## Key files (handicap track)
- `server/src/lib/handicap.js` — the WHS engine (differential, AGS, sliding table, caps, 9-hole guard, COALESCE query).
- `server/src/routes/rounds.js` — solo round POST (now stores hole_handicaps).
- `client/src/pages/ActiveRound.jsx` — solo setup → config → POST (now threads rating/slope/SI).
- `client/src/lib/handicapClient.js` — `courseHandicap`, `playerTeeRatings`.
- `client/src/pages/Outing/{CreateWizard,LiveOuting}.jsx` — match net strokes, CH chip, allowances.
- Migrations 029–033. Audit: `handicap-accuracy-audit-2026-06-25.md`.
