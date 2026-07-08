---
type: synthesis
created: 2026-07-07
updated: 2026-07-07
tags: [eagle-eye, strokes-gained, shot-capture, build-progress, checklist]
status: IN PROGRESS — Slice 0 not started
spec: [[synthesis/eagle-eye-walk-and-confirm-spec-2026-07-07]]
---
# Eagle Eye "Walk-and-Confirm" — Build Progress Tracker

Companion to the build spec ([[synthesis/eagle-eye-walk-and-confirm-spec-2026-07-07]]).
The spec is the design; **this doc is the live checklist.** Slice order: **0 → 1 → 2 → 3 → 4.**

> ⏳ **UPDATE-AS-YOU-GO (Claude: this is a standing instruction).**
> Treat updating this file as part of finishing any Eagle Eye build step:
> 1. Tick the `[ ]` boxes you actually completed (only after the step's **verify** passes).
> 2. Update that slice's **Status** line and the frontmatter `status` + `updated`.
> 3. Append a dated entry to the **Session log** at the bottom.
> 4. Never tick a box on intent alone — audit-before-claim applies (cite the check that passed).

---

## Audit status — DONE (2026-07-07)

The shipped data pipeline the capture UX feeds was audited claim-by-claim against code, prod DB,
and tests. **Foundation is real — do not re-audit or rebuild it.** Verified:

- Migration `042_tm_outing_shots.sql` applied to **prod** (`tm_outing_participants.shots` + `tm_rounds.shots` both `jsonb`, psql-confirmed).
- `shotFacts.js` clean/set + **12/12 vitest pass**.
- Self-only shots write `outings.js` 1050/1056; `/end` sync 2306/2323; solo `rounds.js` 46/93.
- SG engine complete-chain gate + ≥9-shot-hole threshold (`sg/index.js` walkChain 80-91, line 220); re-ran `roundSG` → OTT/APP/ARG populate, 8-chain control → null. ✅
- Every EagleEye/App/Outing/geo line number in the spec matched (exact or within its `~` range).

Full audit + verdict table: session log 2026-07-07 below / chat audit.

---

## 🔧 Carry-forward fixes & invariants (apply to EVERY slice)

1. **LIE KEYS = `tee | fairway | rough | sand | recovery`.** The spec §4e says `trouble` — **that is the display LABEL only.** The server `VALID_LIES` (`shotFacts.js:15`) and SG `OFF_GREEN` (`sg/index.js:88`) both use key **`recovery`**. Emitting `lie:'trouble'` → `cleanHoleShots` silently drops the shot → broken SG chain, no error. **Reuse `ShotSheet.jsx`'s `SHOT_LIES` array (key `recovery`, label "Trouble") — never hard-code `trouble`.** (Spec left as-is per Matt; fix lives here.)
2. **toPin source = `gpsToGreen` (EagleEye.jsx:1297), NEVER `displayYards` (1355).** `displayYards` follows the dragged aim point → corrupts SG.
3. **Hole index:** EE `currentHole` is **1-indexed** (809); the scores/shots arrays are **0-indexed**. Convert in ONE place.
4. **Chain completeness:** SG only counts a hole when `shots.length + putts === score`. A miss silently drops the hole (safe, never corrupts) — but that's why a captured shot can "vanish" from SG.
5. **Gate ALL new EE behavior on `activeScoring`.** With no active round/outing, EE must render exactly as today.
6. **Solo path stores shots RAW** (`rounds.js:97` = `JSON.stringify(shots ?? [])`, no `cleanHoleShots`). Outing path cleans; solo does not. SG's gate makes junk harmless, but Slice 2 should send already-clean shots. (Not in spec — caught in audit.)

---

## Slice 0 — shared per-hole shot buffer (no UI, no behavior change)
**Status:** ⬜ not started

- [ ] New `client/src/lib/shot-capture.js`: `readHoleBuffer / appendShot / clearHoleBuffer`, localStorage keyed `outing:<code>|solo` + uid + holeIdx
- [ ] Route LiveOuting `holeShots` (LiveOuting.jsx:228) through the buffer lib
- [ ] Route ActiveRound `addShot` (ActiveRound.jsx:1011) through the buffer lib
- [ ] **Verify:** existing manual "+ Log Shot" still flows shots → save → SG unchanged (lint + build + `node --check`; manual log a shot on beta, confirm it still lands)

## Slice 1 — outing walk-and-confirm (PRIMARY — build FIRST; no server change)
**Status:** ⬜ not started

- [ ] Lift a minimal `activeScoring` descriptor to App.jsx; publish `activeCode` up from Outing.jsx → App → EE (one callback, symmetric with `onCourseSelected`)
- [ ] Extract `ClubToggle.recommend()` closest-`avg_yards` logic (EagleEye.jsx:2127-2144) to a pure helper (e.g. `lib/clubModel.js`) shared by the toggle + confirm sheet
- [ ] "LOG SHOT" HUD affordance (dark glass), slotted into the bottom stack; gated `courseCtx && activeOutingCode`
- [ ] Dark confirm sheet (createPortal + glass, styled after `PlaysLikeSheet`/`BagSheet`): **distance hero** (snapshot `gpsToGreen` at tap), auto-club chip, lie chips, one-tap **Confirm**
- [ ] `!gpsUsable` → swap distance hero for a manual number field
- [ ] Auto-club suggested for the **captured toPin** (not displayYards)
- [ ] Lie default `tee` if buffer empty else `fairway`; override chips emit **`recovery`** (label "Trouble") — see fix #1
- [ ] Confirm → `appendShot`; shots flush through the existing score-modal save (`saveScore`/`shotRide` 1221/1258)
- [ ] **Verify:** log 2 shots in EE on a par 4 → open outing score modal (pre-filled) → save a 2-putt "4" → end match → `tm_rounds.shots` chain complete → SG shows OTT/APP (browser walkthrough on beta + psql spot-check)

## Slice 2 — solo walk-and-confirm
**Status:** ⬜ not started

- [ ] EE self-discovers the solo round via `readSavedSoloRound(user.id)` (solo-round.js:30) — no App wiring needed
- [ ] Re-hydrate ActiveRound on tab focus (EE tab vs scorecard tab — cross-tab desync)
- [ ] Send **cleaned** shots on `POST /api/rounds` (fix #6)
- [ ] **Verify:** solo round → capture shots in EE → finish → `POST /rounds` → SG lights up categories

## Slice 3 — lie auto-detect v1
**Status:** ⬜ not started

- [ ] Add ray-cast point-in-polygon to `geo.js` (none exists today — audit-confirmed)
- [ ] Use the green polygon to **warn/block** "you're on the green — that's a putt"
- [ ] Keep tee/fairway defaults + one-tap override (keys per fix #1)
- [ ] **Verify:** standing on/off green flips the warning; overrides still write `recovery` etc.

## Slice 4 — fairway/bunker polygons (STRETCH)
**Status:** ⬜ not started

- [ ] New Overpass fetch (`golf=fairway`, `golf=bunker`) + cache bump
- [ ] PIP → true auto lie (fairway vs rough vs sand); degrade to Slice-3 defaults when OSM has no data
- [ ] **Verify:** auto lie matches ground truth on a mapped hole; graceful fallback on an unmapped one

---

## Pre-push gate (the-match beta discipline — every push)

- `npm --prefix client run lint` (ESLint `no-undef` — a clean `vite build` is NOT enough; it shipped an undefined ref to beta on 2026-06-06)
- `npm --prefix client run build`
- `node --check` on any changed server file (+ `npm run test --workspace=server` if server touched)
- **Beta phase: `main` IS the test env** → build-verified feature code goes to `main`. **But ask Matt before every commit/push** (CLAUDE.md hard rule). Additive + `activeScoring`-gated keeps it reversible.

---

## Session log

### [2026-07-07] audit + tracker created
- Audited the gameplan claim-by-claim (foundation VERIFIED; one real error = §4e lie key `trouble` → `recovery`, now carried as fix #1; two caveats logged as #6 + the e2e-magnitude note). Full verdict table in chat.
- Created this progress tracker. No build code written yet — Slice 0 is next.
