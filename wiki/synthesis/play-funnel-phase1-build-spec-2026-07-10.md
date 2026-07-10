---
type: synthesis
created: 2026-07-10
updated: 2026-07-10
tags: [eagle-eye, play-tab, start-funnel, course-picker, solo, ux, phase-1]
---

# Play funnel — Phase 1 build spec + progress checklist (2026-07-10)

Parent plan: [[synthesis/start-match-unified-flow-plan-2026-07-09]] (Phase 1). Phase 0
(nav restructure) shipped `c194432`. Grounded in two fresh agents this session:
a market micro-UX research agent (start-funnel details + failure states + review
complaints across 18Birdies/Golfshot/Hole19/SwingU/TheGrint/Arccos/Garmin/GolfLogix)
and a Plan agent (full seam map with file:line refs, verified at HEAD `8e58676`).

## 1. Research distilled — the bar to beat

- Fastest incumbents (SwingU, TheGrint): ~2–3 taps to hole-1 distance; slowest
  (18Birdies free): ~5+ taps with upsell interstitials — the single loudest
  start-flow complaint class across all eight apps is *stuff between Play and tee 1*
  (upsells, onboarding carousels, forced group screens, login walls).
- Convergent best pattern: GPS course presented as a visible confirm (never invisible
  auto-start — wrong-course lock-on is the #1 trust killer), "not here?" → nearby list
  not a search box, facility→course disambiguation inline, remembered per-course tee.
- **Nobody handles GPS-denied well** — every app punts to a support article. A real
  degraded mode (static card yardages + honest banner + Settings deep-link) is an open
  lane, as is honest ±accuracy display while the fix is poor.
- Target: **2 taps from app-open to hole-1 distance** when the course guess is right
  (Play tab → "Play <course>"), zero interstitials as policy, solo as the default and
  Match one extra tap.

## 2. Architecture (from the Plan agent — see agent seam map in this spec's log entry)

- **Two divergent CoursePickers**: dark sheet `EagleEye.jsx:432-582` (portal, miles,
  client-side haversine sort, emits `{course,tee}`) vs light inline
  `CreateWizard.jsx:60-290` (sends lat/lng to `/api/courses/search`, km, emits slim
  pick incl. `teeRatings` + parallel `onCourseTeeSelected`), the latter reused by solo
  `SetupSheet` (`ActiveRound.jsx:120-125`) which omits BOTH `onCourseTeeSelected` and
  `gender` (two bugs in one seam: never seeds `sharedCourse`; solo tee dedupe silently
  defaults male).
- **New files**: `lib/useCourseSearch.js` (shared search/detail data hook; one
  geolocation source), `components/CoursePicker.jsx` (ONE component, `variant="sheet"`
  | `variant="inline"` — JSX moved VERBATIM per variant; pixel fidelity by literal JSX,
  only the data layer is shared), `lib/course-recents.js` (`tm-recent-courses` LS list
  with lat/lon + lastTee; `nearestRecent(gps)` — the beta nearest-course source since
  there is NO nearby API: `/api/courses/search` requires `q`; GolfCourseAPI is proxied
  by text only).
- **Play start screen**: new `pages/PlayStart.jsx` mounted INSIDE EagleEye replacing
  the Welcome-hero branch (`EagleEye.jsx:2002-2069`) — EagleEye already owns gps/
  gpsError/requestLocation (gesture-driven for iOS WKWebView) and the `!courseCtx`
  condition. Resume path untouched (courseCtx present → map as today).
- **Hole-index rule** (invariant): `currentHole`/`eyeHoleNudge`/UI are 1-indexed;
  anything crossing into `shot-capture.js`/`solo-round.js` is 0-indexed; convert only
  at that boundary.

## 3. Decisions taken this session (flag to Matt; overridable)

1. **Nearest-course source = recents + search-first empty state.** No `/nearby`
  endpoint exists and GolfCourseAPI is text-query only; a real nearby API needs a
  course cache/Overpass matcher — logged as a fast-follow, NOT silently skipped.
2. **Match-light path lands on the map with a one-time "code ABCD — invite" chip**
  (jump to live outing); heavy CreateWizard stays on the Match tab.
3. **GPS-only toggle deferred to Phase 3** — per the parent plan's own sequencing.

## 4. Slices + progress checklist (each independently shippable; gate = client build+lint [+ node --check if server touched])

- [x] **S1a** Extract `useCourseSearch` + sheet variant; swap Eagle Eye's picker —
      BUILT 2026-07-10 (`f15bcb8`). Verified: build+lint green. NOT yet verified:
      on-device pixel check of the dark sheet.
- [x] **S1b** Inline variant; swap CreateWizard + solo SetupSheet imports — BUILT
      2026-07-10 (`f15bcb8`; CreateWizard re-exports for compat). Verified:
      build+lint; `selectTee` payload byte-identical (JSX/logic moved verbatim).
      NOT yet verified: wizard walkthrough + league prefill in a browser.
- [x] **S2** Solo seeds `sharedCourse` + gender-correct tees — BUILT 2026-07-10
      (`f15bcb8`): onCourseTeeSelected+gender threaded Outing→ActiveRound→SetupSheet;
      saveEyeHole(courseId,1) on pick (helpers extracted to lib/eye-hole.js);
      courseId/courseTee in the solo config. NOT yet verified: live solo→Play flow.
- [x] **S3a** `lib/course-recents.js` — BUILT 2026-07-10: upsert-by-id capped 10,
      lat/lon/lastTee preserved across sparse writers; written by both picker
      variants + LiveOuting seed. Corrupt JSON tolerated by construction (try/catch
      + array filter). NOT yet verified at runtime.
- [x] **S3b** PlayStart screen — BUILT 2026-07-10: pages/PlayStart.jsx replaces the
      Welcome hero (confirm card nearest-recent-≤5mi → last-played → search; other-
      recents chips; 9|18; Solo|Match; remembered tee resolved via detail fetch +
      dedupeTees; Resume card when a solo blob exists — startSoloRound refuses
      double-start by design; "Rangefinder only" keeps the zero-scoring path;
      Enable Location preserved). NOT yet verified: any browser/device walkthrough.
- [x] **S3c** Match light path — BUILT 2026-07-10: EagleEye startRound → ensure-
      SingleActive guard → POST /api/outings (name-only-required contract verified
      against server route outings.js:365-420; light defaults, teeRatings both-
      gender) → invite chip on map + onMatchStarted → App pendingOpenCode → Outing
      opens live view w/o join POST + tm-solo-started listener. NOT yet verified:
      e2e in a browser (guard sheet, activeScoring publish, chip → live outing).
- [~] **Audit** (audit-before-claim skill) — run 2026-07-10; verified/not-verified
      split recorded above + in wiki/log.md. REMAINING: browser e2e sweep + Matt's
      on-device pass (see §7 device checklist).

## 5. Risk register (top items; full table in Plan-agent output)

- **Stale per-course hole resume**: `readEyeHole` would resume a NEW round at hole 14
  → on explicit start, `saveEyeHole(courseId, 1)` BEFORE `onCourseSelected`.
- **sharedCourse write races** (3 writers + LS): keep LiveOuting first-load-only rule;
  PlayStart writes last (user intent dominates).
- **activeScoring transient null** on S3c mount ordering → consume `pendingOpenCode`
  in Outing's first effect; verify on device.
- **iOS WKWebView geolocation**: request only in a user gesture (existing pattern);
  PlayStart renders search-first and UPGRADES to confirm chip when the fix arrives.
- **CreateWizard league path**: move JSX verbatim; keep `selectTee` payload
  byte-identical; manual regression per S1 slice.
- **Solo blob shape**: `startSoloRound` writes the exact autosave shape
  (phase 'scoring', config.pars, zeroed arrays) so the restore validator accepts it.
- **Pixel regressions**: no style unification in Phase 1 — variants keep literal JSX.
- **Duplicate solo state**: Start(Solo) refuses when `readSavedSoloRound` exists.

## 6. Session log

- 2026-07-10: spec written; S1a+S1b+S2 built and pushed (`f15bcb8`); S3a/S3b/S3c
  built same session. Gate each push: client build + lint green; `npm test` 11/11
  (note: the npm test script covers 11 tests — the larger per-file suites
  (geo/clubModel/shot-capture) run via node --test directly and were NOT run this
  session). No server files changed. Audit skill run; honest split in §4 ticks.

## 7. Device checklist for Matt (the NOT-yet-verified set)

1. Play tab, no active round: confirm card shows your nearest/last course with your
   last tee; "Play at <course>" → hole-1 map in 2 taps; hole starts at 1 (not a
   resumed hole) even at a course you've played.
2. Solo start from Play → Match tab shows the round live (scorecard + resume);
   score a hole; shot capture (LOG SHOT) works with scope solo.
3. Match start from Play → invite chip appears; tap → live outing; code joinable
   from a second account; scoring rides the outing (activeScoring armed).
4. "Not here?" → picker → start continues in the chosen mode; "Rangefinder only"
   → old behavior (map, no round).
5. Pickers look pixel-identical: EE dark sheet + wizard step-0 + solo setup.
6. Wizard: create a league event ("+ New event" from a league) end-to-end.
7. With another match live: Play → Match → guard sheet appears (discard-or-cancel).
