---
type: synthesis
created: 2026-07-08
updated: 2026-07-08
tags: [the-match, handoff, active]
---

# Next-Session Handoff — 2026-07-08 (ACTIVE; supersedes 2026-07-07)

Mandatory start: **roll-call → wiki/index.md → this file + `wiki/log.md`'s latest entries**, then the two Eagle Eye docs:
- Spec (design): [[synthesis/eagle-eye-walk-and-confirm-spec-2026-07-07]]
- **Progress tracker (the live checklist + risk register): [[synthesis/eagle-eye-walk-and-confirm-progress-2026-07-07]]** ← read this; it's the source of truth for status.

Everything below is SHIPPED + verified unless marked pending.

## TL;DR
Eagle Eye **"walk-and-confirm" shot capture** is built and mostly live-verified. **Slices 0, 1, 3 + solo clean-on-save are on `main`.** Capture works for **any** active Eagle Eye round (solo OR outing). Remaining: **Matt's on-course pass** (real GPS) + **Slice 4** (stretch — full fairway/rough/sand auto-lie). Nothing is blocked.

## What shipped this session (commits on `main`)
- `ff010cb` — spec + progress tracker (docs)
- `3fcbe28` — **Slice 0**: shared per-hole shot buffer (`shot-capture.js`) + solo façade + `ScoreModal` rewire + 20 unit tests (no behavior change)
- `bb83047` — **Slice 1**: EE capture — `ShotCaptureSheet`, LOG SHOT pill, **plays-like club rec**, "forgot-to-log" backfill, trust nudges
- `78d46b7` — **capture opened to ALL EE rounds** (solo + outing) with a race-safe solo-blob sync
- `444cb58` — tracker (live-verification notes)
- `7da5c3b` — **Slice 3**: on-green guard (`pointInPolygon`) + **solo clean-on-save**

## Current state (what works)
- **LOG SHOT** pill in the EE HUD whenever a round is active (live outing OR self-discovered solo). Standalone EE (no round) shows nothing new.
- **Confirm sheet** (dark "instrument"): distance hero (or a **manual field when GPS isn't locked**), **plays-like** club recommendation + one-gesture club strip, lie chips (tee/fairway/rough/sand/**recovery**), **on-green guard**, **trust nudges** (>500y / non-decreasing distance).
- Shots flow: outing → the existing score save (`shotRide`); solo → the shared round blob → both land in `tm_rounds.shots` → read-time SG (OTT/APP/ARG).
- **LIVE-VERIFIED on the beta (Claude-in-Chrome, 2026-07-08):** LOG SHOT shows for a solo round; a confirmed shot wrote `{lie:"tee",toPin:165,club:"7i"}` into the round blob (correct SG shape); map renders; plays-like computes. (Test shot cleaned up.)

## Verified vs PENDING (be honest with Matt)
- **Verified** (unit + build + live browser): the whole capture data path + the UI render + solo/outing routing.
- **PENDING — needs real GPS on-course** (desktop Chrome has geolocation **DENIED**, so these ran only their fallback path): the **GPS→plays-like HERO** ("150 · plays 162") and the **on-green warning actually firing**. Both are code + unit verified; only the GPS-driven runtime is unconfirmed. **→ This is Matt's on-course pass.**

## Carry-forward invariants — DO NOT REGRESS
1. **Lie keys = `tee/fairway/rough/sand/recovery`** (label "Trouble"). NEVER emit `lie:'trouble'` — the server (`shotFacts.js VALID_LIES`) silently drops it → the hole leaves SG. Single source = `SHOT_LIES` exported from `components/scorecard/ShotSheet.jsx`.
2. **`toPin` stored = RAW `gpsToGreen`** (SG keys on actual distance-to-pin). Plays-like is CLUB ADVICE only — never stored.
3. EE `currentHole` is **1-indexed**; buffer/scores/shots arrays are **0-indexed**. Convert once (`currentHole - 1`).
4. SG counts a hole only when **`shots.length + putts === score`**. The `ScoreModal` completeness hint + "+ Add missing shot" backfill surface mismatches (non-blocking).
5. Gate all new EE capture on **`activeCapture`** (outing OR solo).
6. **Solo shots ride the ONE shared round blob** via `lib/solo-round writeSoloShots`, which fires `tm-solo-shots` → `ActiveRound` re-hydrates (kills the clobber race). Do NOT add a second solo store.

## Key files
- `client/src/lib/shot-capture.js` — the buffer (scopeKey/read/append/write/clear; solo delegates to the façade)
- `client/src/lib/solo-round.js` — `readSoloShots`/`writeSoloShots` (+ `tm-solo-shots` dispatch)
- `client/src/pages/EagleEye.jsx` — `ShotCaptureSheet` (~816); `activeCapture` + capture state (~1403); LOG SHOT onClick (~2057); sheet render (~2187)
- `client/src/pages/Outing/LiveOuting.jsx` — `ScoreModal` (buffer-hydrated `holeShots`; completeness hint + backfill)
- `client/src/pages/ActiveRound.jsx` — solo `shots` + the `tm-solo-shots` re-hydration listener
- `client/src/lib/clubModel.js` — `recommendClub` (raw-bag closest `avg_yards`)
- `client/src/lib/geo.js` — `pointInPolygon` (on-green)
- `server/src/lib/shotFacts.js` — `cleanHoleShots` / `setShotsAtHole` / `cleanShotsForRound` / `VALID_LIES`
- `server/src/routes/rounds.js` — solo `POST /rounds` (now cleans via `cleanShotsForRound`); `routes/outings.js` — outing write + `/end` sync
- `server/src/lib/sg/index.js` — the read-time SG engine (complete-chain gate, ≥9 shot-holes for round-level)

## Remaining work
1. **Matt's on-course pass** (real GPS): confirm the plays-like hero + on-green warning fire; play/log a real round → SG OTT/APP/ARG populate end-to-end on a phone.
2. **Slice 4 (stretch) — full lie auto-detect**: new Overpass fetch for `golf=fairway` + `golf=bunker` polygons + a cache bump (see `tm_osm_cache`), then PIP against those to auto-classify fairway/rough/sand; degrade to the Slice-3 tee/fairway defaults when OSM has no data. Only verifiable on-course. Spec §5 Slice 4.
3. Minor: confirm haptic is a **no-op in WKWebView** (`tmHaptic` = `navigator.vibrate`, which iOS ignores). Real Taptic needs a `webkit.messageHandlers` → `UIImpactFeedbackGenerator` native bridge — a separate native-shell task, NOT part of this feature.

## Verify gates (every push)
`npm --prefix client run lint && npm --prefix client run build && npm --prefix client run test` · `npm run test --workspace=server` · `node --check` on changed server files. **Beta = `main`; ASK Matt before every commit/push** (CLAUDE.md hard rule).

## Test counts (current, all green)
client: **geo 38 · clubModel 16 · shot-capture 20** · server: **97** (shot-facts 14). `node --check` clean on touched server files.
