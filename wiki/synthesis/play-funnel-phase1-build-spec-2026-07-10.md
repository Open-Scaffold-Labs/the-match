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

- [ ] **S1a** Extract `useCourseSearch` + sheet variant; swap Eagle Eye's picker
      → verify: build+lint; dark sheet pixel-identical; search→tee→use lands on map
      hole 1 and writes `sharedCourse`.
- [ ] **S1b** Inline variant; swap CreateWizard + solo SetupSheet imports
      → verify: build+lint; wizard step 0 identical; league prefill (`pendingLeagueId`)
      unaffected; slim pick still carries `teeRatings`/rating/slope into POST
      /api/outings; solo setup visually unchanged.
- [ ] **S2** Solo seeds `sharedCourse` + gender-correct tees (pass
      `onCourseTeeSelected` + `gender` through Outing→ActiveRound→SetupSheet; extend
      solo config with courseId/courseTee)
      → verify: solo round with picked course → Play tab shows that course/tee with no
      manual pick, hole 1 fresh (saveEyeHole(courseId,1) before onCourseSelected).
- [ ] **S3a** `lib/course-recents.js` recents store, written by both variants +
      LiveOuting seed
      → verify: build+lint; picks append capped list; corrupt JSON tolerated.
- [ ] **S3b** PlayStart screen (solo path): confirm chip from `nearestRecent(gps)` →
      recents → search fallback (sheet picker); tee row remembered/`dedupeTees`;
      Solo|Match segmented (Solo default); Start(Solo) = `startSoloRound()` helper +
      `saveEyeHole(courseId,1)` + `onCourseSelected`; `tm-solo-started` event so a
      mounted Outing flips to solo view; refuse double-start when a solo blob exists
      (offer Resume)
      → verify: 2–3 taps to hole-1 distance with a nearby recent; active round still
      resumes instantly; Match tab shows the Play-started round as resumable.
- [ ] **S3c** Match light path: Start(Match) → active-match guard → POST /api/outings
      (light defaults) → stay on map + one-time invite chip; `pendingOpenCode` App
      plumbing (no join POST — host already participant); SCORECARD pill → live outing
      → verify: full loop incl. `activeScoring={kind:'outing'}` shot capture, guard
      sheet when another match live, league/event creation still works.
- [ ] **Audit** (audit-before-claim): per-claim evidence, honest
      verified/not-verified split, device-check list for Matt.

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

- 2026-07-10: spec written; S1a begun.
