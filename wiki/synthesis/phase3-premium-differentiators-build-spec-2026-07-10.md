---
type: synthesis
created: 2026-07-10
updated: 2026-07-10
tags: [phase-3, shot-editor, flyover, strokes-gained, plays-like, gps-only, premium]
---

# Phase 3 — Premium differentiators: build spec + LIVE checklist (2026-07-10)

Parent: [[synthesis/start-match-unified-flow-plan-2026-07-09]] §5 Phase 3. Grounded in
THREE fresh agents this session: (1) post-round-editor competitive research
(Arccos/Shot Scope/18Birdies/Golfshot/Hole19/Garmin/TheGrint/TRAKD + complaint
mining), (2) GPS-only + plays-like legibility research, (3) a very-thorough Plan
agent seam map verified at `b7a5891`. Goal (Matt): biggest name in golf apps —
usability, accuracy, visual flow; bulletproof build.

## 1. Research distilled — the bar to beat

**Post-round editing:** the convergent flow is per-hole satellite map → shot pins +
polyline → tap pin → club/lie sheet → add via map tap → separate zoomed green view
for putts → per-hole confirm → round sign-off gating stats (Shot Scope's pattern —
the best trust idea in the market). Target: 3–5 min per 18; more = churn.
**Complaint traps (loudest):** sensor false-positives forcing tedious cleanup
(Arccos "not worth it" reviews); fiddly pins / no zoom / EDITS FAILING TO SAVE;
putts silently inferred wrong (gimmes); forced hole-by-hole homework; SG behind a
second paywall; SG vs tour baseline demoralizing (fix = vs-your-handicap default —
we already have `sg_baseline`).
**Unclaimed territory (verified):** (a) NOBODY fuses the flyover replay with the
editor — every editor is a flat map, every flyover is separate eye candy;
(b) nobody does map-based full post-hoc entry for zero-capture rounds (only a
scorecard-form app handles post-hoc gracefully at all); (c) sign-off progress
("14/18 SG-ready") + one-tap "looks right" per hole.
**Our structural advantage:** one-tap capture means NO false-positive cleanup class
at all — never guess shots the user didn't log.

**GPS-only:** market gap = no app upgrades a yardage-only session into a scored
round without loss (the "keep score?" trap complaints). BUT the-match doctrine
(PlayStart.jsx:20-23, Matt 2026-07-10) says NO "rangefinder mode" framing — EE is
ONE surface. So Phase 3's GPS-only deliverable is the UPGRADE SEAM, not a mode:
browsing course yardages → START scoring without losing your place.

**Plays-like:** best-in-class = raw stays hero, adjusted adjacent + visually
distinct with SIGNED delta; per-factor tap-to-explain (± yds each) is what earns
trust; the market leader's failure is silent garbage inputs (stale weather,
uncalibrated baro) folded into the total. We already have raw hero + delta chip +
a per-factor adjustable sheet with sourced physics — Phase 3 is legibility +
honest degradation, not new math.

## 2. Verified current state (Plan agent, at `b7a5891`)

- `tm_rounds.shots` jsonb since 001; shape `{lie,toPin,club?}` per shot, per-hole
  arrays 0-indexed, canonical cleaner `server/src/lib/shotFacts.js:15-32`
  (**strips unknown keys** — pos persistence needs an additive passthrough).
- SG = server read-time only (`server/src/lib/sg/index.js`); chain gate
  `shots.length + putts === score` (80-112); handicap NEVER reads shots; editing
  shots post-hoc is provably analytics-only.
- NO post-hoc shots endpoint exists; the clone template is
  `PATCH /api/rounds/:id/putts` (`rounds.js:256-279`, owner-checked).
- Outing shots reach `tm_rounds` only at `/end` (`outings.js:2294-2337`, copied
  WITHOUT re-clean — PATCH re-clean covers later edits).
- HoleMapGL: course-editor seam shipped yesterday (device-unverified) — the shot
  editor gets a PARALLEL seam (shotDraft/onShotTap + shotPts/shotLine +
  redrawShots) so the course editor is untouched; flyTo cinematic at :596 is the
  proven camera ceiling; standalone-mountable (needs geocoded + position maps +
  currentHole; courseCtx optional).
- "Rangefinder only" does NOT exist in PlayStart (stale comment only); browse =
  pick course without starting (persists via sharedCourse; no session, no record;
  START today resets to hole 1 — browse position lost).
- Plays-like surfaces: dial chip `EagleEye.jsx:2669-2684`, BIG line 2793-2807,
  PlaysLikeSheet 573-669 (per-factor rows, wind dial, steppers), capture-sheet
  line ~715.

## 3. Decisions (taken autonomously per Matt's "lock in"; flag-for-device-pass noted)

1. **Persist pin positions**: yes — additive `lat`/`lon` passthrough in
   `cleanHoleShots`; SG provably indifferent (walkChain reads lie/toPin only).
   Without it, reopening the editor re-estimates pins = placement evaporates.
2. **Parallel HoleMapGL seam**, no generalization of the day-old course editor.
3. **One PATCH** `/api/rounds/:id/shots` optionally accepting `putts`/`firstPutts`
   (putts validation reused verbatim) so full post-hoc entry is atomic;
   `PATCH /:id/putts` untouched.
4. **Closed-rounds-only v1**: the editor opens for saved solo rounds + ended
   outings (tm_rounds rows). Live capture stays in the on-course sheets.
5. **GPS-only = upgrade seam only** (doctrine-compliant): starting a round on the
   SAME course you're actively browsing keeps your current hole instead of
   resetting to 1. ⚑ FLAG for Matt: Phase-1 doctrine says "a new round must open
   on hole 1" — that targeted STALE per-course memory; this is a live-browse
   continuation (you're standing on hole 6). Device-pass judgment call.
6. **SG baseline default stays vs-handicap** (`sg_baseline` exists) — no change.
7. **Flyover = the hole-change camera** (drawHole's existing cinematic flyTo) —
   the editor IS the flyover (unclaimed territory), per-hole not per-shot in v1
   (WKWebView perf; reduced-motion honored for free).

## 4. Slices + LIVE checklist (gate: client `npm --prefix client run build` + `lint`; server `node --check` + vitest)

- [x] **S1 (server)** `PATCH /api/rounds/:id/shots` — BUILT 2026-07-10
      (`d9da51e`), route-level tests added in the audit pass (`d5198a3`): real
      router + REAL requireAuth (signed JWT), db singleton patched via node's
      require registry; locks auth 401, validation 400s, server re-clean incl.
      pin positions, owner-404 (user_id last param + WHERE), atomic putts
      ride-along, firstPutts-length degradation. 107/107 vitest green.
- [x] **S2 (server)** `lat`/`lon` passthrough in `cleanHoleShots` — BUILT
      2026-07-10 (`d9da51e`); SG-indifference pinned by test (identical
      holeShotsSG with/without positions).
- [x] **S3 (server, added during build)** `tm_rounds.course_id` (migration 044)
      — DISCOVERED gap: tm_rounds had NO course reference, so the editor
      couldn't load geometry. Additive BIGINT + outing backfill; **APPLIED to
      prod 2026-07-10 via Supabase MCP (9/50 rounds backfilled, verified by
      count query)**. Writers: solo POST (`courseId` from config) + `/end`
      fan-out (`outing.course_id`) (`ca0d9d0`). Legacy/free-form → null →
      list fallback.
- [x] **C1 (client)** Plays-like — VERIFIED already shipped at HEAD: signed
      delta w/ amber/green direction color on chip AND BIG line; "—" honest
      degradation in PlRow; silent-default trap unreachable (playsLike computes
      only with live weather). Net-new this session: per-factor SOURCE captions
      (live forecast / USGS terrain model) (`5b3b7a6`).
- [x] **C2 (client)** HoleMapGL parallel shot seam — BUILT 2026-07-10
      (`1e15e0f`): shotMode/shotDraft/onShotTap, guarded shotPts/shotLine,
      redrawShots per the redrawEdit contract, pin-hit via 12px-pad
      queryRenderedFeatures; aim marker inert in shot mode (incl. mid-session
      recreation). EagleEye untouched (never passes shotMode).
- [x] **C3+C4 (client)** `ShotEditor.jsx` — BUILT 2026-07-10 (`acb0d2c`), all
      spec behaviors incl. SG-ready per-hole indicator + round progress,
      PATCH-on-hole-advance + retry chip, overrides-first geometry (course-
      editor synergy), zero-capture/null/short arrays first-class, no-map
      manual fallback (shared ShotSheet). Deviation from spec: pins seed by
      straight-line green→tee walk-back (not along-geometry) — simpler,
      estimate-only until touched.
- [x] **C5+C6 (client)** Entry points + flyover — BUILT 2026-07-10 (`c49e795`):
      solo post-save OPTIONAL review offer (never homework), EndMatchScreen
      "Review your shots" (server `round_ids` added to /end summary),
      RoundScorecard sibling of Add-putts w/ tagged count. Flyover = HoleMapGL's
      existing per-hole cinematic (reduced-motion honored for free).
- [x] **C7 (client)** Browse→scoring upgrade seam — BUILT 2026-07-10
      (`d46e625`) ⚑ same-course START preserves the browsed hole; fresh/
      different course still opens hole 1. Flagged for Matt's device pass.
- [x] **Audit** — run 2026-07-10 (audit-before-claim + design-critique):
      **VERIFIED**: 107/107 server vitest (incl. 8 new route tests); build+lint
      green per slice; migration 044 live on prod (count-verified); every
      commit pushed (`d9da51e`→`6ba1f30`).
      **NOT VERIFIED — zero runtime/browser/device execution of ANY client
      slice**: ShotEditor has never been rendered; the PATCH has never been
      exercised against the real DB (route tests stub the db); /end round_ids
      never exercised live; C7 never exercised. §7 device checklist is the
      done-gate.
      **Design-critique fixes applied** (`6ba1f30`): 44px touch targets,
      aria-labels on hole nav, SG-ready green → #8FCB9B (dark-surface
      contrast). **Follow-ups logged, not built**: jump-to-hole picker (18
      taps to hole 18 today), ShotSheet's club-first flow is friction for
      post-hoc manual entry (shared component — change deliberately), pin
      drag (v2; move = select + tap today), zoomed green view for putts (v2,
      the market's putt benchmark), shareable flyover clip (v2 — research's
      "reward moment").

## 5. Risk register

1. **Shot edits corrupting SG/handicap** — LOW: handicap never reads shots
   (verified); SG chain gate degrades to null, never wrong. Server re-clean
   mandatory (never trust editor output). Editor shows chain feedback so a
   user-broken chain is visible, not silent.
2. **Breaking the day-old course editor** — parallel seam only; the two editors
   can never be active simultaneously (ShotEditor is its own overlay page, not
   EagleEye); no shared handler double-fire (separate `map.on('click')` guarded
   by its own ref).
3. **TDZ / no-use-before-define** — redrawShots follows the assign-after-
   declaration contract; ShotEditor declares all state above effects/dep arrays.
4. **Zero-capture rounds** — the common case: seeding needs only scores +
   hole_pars (always present); pins need geometry — overrides-first (course
   editor synergy), OSM golf=hole ways second, manual list fallback third. Putts
   missing → inline putt entry (same PATCH). No dead ends.
5. **Outing vs solo** — editor targets `tm_rounds` only (closed rounds);
   mid-outing editing stays in the capture sheets. `/end` copies shots without
   re-clean — PATCH re-clean covers subsequent edits; SG gate protects reads
   regardless.
6. **Null/short/missing shots arrays** — treat null/[]/short identically (pad to
   hole count; `setShotsAtHole` precedent).
7. **WKWebView flyover perf** — per-hole flyTo only (the shipped 3200ms/pitch-62
   ceiling); never chain flyTo before moveend; reduced-motion honored.
8. **Any-auth round reads** — `GET /api/rounds/:id` is any-authenticated-user
   readable by design; the editor UI gates on ownership and the PATCH enforces
   `user_id` server-side. Never render edit affordances for non-owners.

## 6. Device checklist for Matt (post-build)

- [ ] Open a past solo round w/ captured shots → pins seeded sensibly, flyover
      per hole, edit a pin's lie, save, Stats SG reflects it.
- [ ] Open a zero-shot past round → tap-in a full hole (shots + putts) →
      SG-ready ✓ appears; round progress counts up.
- [ ] Ended outing → EndMatchScreen row → own shots editable, others' not.
- [ ] Kill app mid-edit → saved holes persist (PATCH-per-hole), unsaved hole
      reverts cleanly.
- [ ] Airplane mode save → retry chip; retry on reconnect succeeds.
- [ ] Plays-like chip: delta color (longer amber / shorter green); sheet shows
      "—" when elevation/wind unavailable (kill network, cold cache).
- [ ] Browse course on hole 6 → START solo → map stays hole 6 (⚑ judgment call);
      fresh-course start opens hole 1.
- [ ] Normal EE + course editor: pixel-identical / unaffected.
