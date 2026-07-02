---
type: synthesis
created: 2026-07-02
updated: 2026-07-02
tags: [the-match, eagle-eye, handoff, plays-like, distance, build-plan]
---

# Next-Session Handoff — Eagle Eye + Bulletproof Build (2026-07-02)

*Read this first, then `wiki/log.md` (most recent entries) and `wiki/POST-LAUNCH-TODO.md`.
This is the running handoff; the prior one is `next-session-handoff-2026-06-30.md`.*

## TL;DR — where things stand

- **Eagle Eye distances are ACCURATE on-device.** Matt confirmed on the live beta (Pebble
  Creek, Colts Neck NJ, White tees, hole 6) that the tee/aim/green numbers are correct.
  **Do not touch the distance code on a theory.** It works.
- The whole **plays-like accuracy rebuild** (sourced coefficients + carry cap + Option B
  aim-retarget) shipped last session and stands. See
  `playslike-accuracy-rebuild-2026-06-30.md`.
- **Phase 0 "bulletproof" foundation build is COMPLETE** (WP-0.A through 0.F). See
  `phase0-foundation-build-spec-2026-06-30.md`. Nothing open there.
- This session was **debugging + polish only** — no new features. The big lesson is
  process, captured below.

## What we did this session (2026-07-01 → 07-02)

**On-map distance label redesign (shipped):**
- Bare outlined tabular numbers only — no "y" / "to grn" suffixes. Gold flag glyph on the
  to-green number.
- Par-3 / aim-on-green case shows a **single** flagged number (not "180" + a stray "0" with
  a flag). Logic: `aimAtGreen = aimGreen <= 2`.
- In-place text updates via a `.ee-dist-num` span; marker only recreated when the flag
  state flips.
- Map pin flag currently **red `#E53935`** (Matt compared gold vs red, landed on red).
- **Tap-to-measure on the map was REMOVED** (the `map.on('click')` handler) — it was
  redundant, ugly, and didn't clear. Gone on purpose; don't re-add.

**Distance-accuracy debugging (the main thread):**
- Symptom chain Matt reported: conflicting aim numbers (164 vs 132), past-green readings
  wildly wrong (219 for a shot that should be ~435), a front-of-green label showing 371 on
  a ~335 hole.
- **Root cause that was real:** the old aim labels used **scorecard-proportional scaling**
  (forcing tee→aim + aim→green to sum to the scorecard yardage). That method is never
  correct and breaks completely past the green. **Fix: pure great-circle (haversine)
  distance** for each segment. Past-green now grows correctly. Matt confirmed: "that worked."
- There is a `teeOffset` band-aid in `HoleMapGL.jsx` (both `redrawAim` and `emitAim`):
  `teeOffset = max(0, haversine(tee,green) − scorecardYards)`, subtracted from the tee→aim
  label. **LEAVE IT.** It is currently load-bearing for keeping the labels consistent with
  the scorecard hero number. It is working. Do not strip it without Matt's explicit
  go-ahead AND on-device verification — removing it risks re-breaking the labels.

**The process lesson (most important part of this handoff):**
- I repeatedly asserted a diagnosis as FACT from arithmetic on screenshots — claimed the
  app was "measuring from the misplaced OSM back tee, 388 vs 335, a 53-yard error." I never
  verified the app's actual runtime tee coordinate. **I was wrong.** Matt set the tee data
  accurately and the app reads the White tee correctly; there is no back-tee bug.
- I also verified against the WRONG course twice (Pebble Creek College Station TX instead of
  Colts Neck NJ) and mislabeled `tm_courses` as "the course cache" (it's vestigial/unused;
  course data is live from golfcourseapi.com — OSM geometry is what's cached, in
  `tm_osm_cache`).
- **Standing instruction from Matt, carry it forward:** *STOP MAKING ASSUMPTIONS — ONLY
  SPEAK FROM VERIFIED FACTS.* Before any claim about geometry/tees/distances, query the real
  data (OSM in `tm_osm_cache`, the actual course = Pebble Creek **Colts Neck NJ**, tees =
  **White**). Do not infer numbers off screenshots and present them as fact.

**Verified OSM facts for Pebble Creek Colts Neck (for reference, so nobody re-derives them):**
- bbox `40.2777361,-74.1716778,40.2901535,-74.1607334`, `osm_type='teegreen'` in `tm_osm_cache`.
- Hole 6 green ≈ `40.2795951,-74.1643804`. Six tee boxes cluster at hole 6; tee→green
  distances: **386, 354, 348, 337, 323, 303 yд**. White ≈ the **337** box (scorecard 335).
  OSM has all six tees mapped correctly — geometry is accurate.

## The two master plans — READ THESE, they hold the roadmap

Next session should drive off these two living docs, not this handoff alone:

1. **`build-plan-bulletproof-2026-06-23.md`** — the master build roadmap (zero-cost stack,
   risk register, Phases 0–4 + Track H handicap + Track F scale/hardening, progress
   checklist, open operational/cost decisions).
2. **`eagle-eye-premium-plan-2026-06-23.md`** — the Eagle Eye premium look + accuracy
   roadmap (thesis, design critique, Phase 0 foundation → Phase 1 hero instrument →
   Phase 2 leapfrog features → Phase 3 app-wide premium polish).

✅ **Both plans were brought current THIS session (2026-07-02).** Phase 0 status was
corrected to **PARTIAL (◐), not "shipped"** — an earlier edit this session overclaimed it as
fully done; the audit + a code check corrected it. Ground truth (code-verified 2026-07-02):
**0.2 tabular numerals = DONE** app-wide (`tokens.css:145-146,323`); **0.1 shadows/grain +
0.3 motion = PARTIAL** — the primitives are in code (`--tm-shadow-layered` token
`tokens.css:92,331`; grain overlay on the Eagle Eye hero `EagleEye.jsx:2014`; reduced-motion
block `tokens.css:360`) but the **app-wide application + the inline-style→token refactor are
NOT done (= Phase 4.3)**. The **custom-font item (WP-0.B) is DROPPED by decision** (keep SF
Pro). ⚠ Note a **source discrepancy** flagged in both plans: the Phase 0 spec §7 checklist
shows these WPs `☐` and the 06-30 log says "C/D/F deferred," but the code shows the
primitives landed — treat the code citations as ground truth and reconcile the log next pass.
The bulletproof plan also records the plays-like accuracy rebuild (Phase 3.1) and this
session's on-map label + great-circle distance fix (Phase 2). Verifications this session:
`geo.test.mjs` re-run 31/31; great-circle confirmed in `HoleMapGL.jsx:428,460-461`.

## Eagle Eye — where to pick up

Distances are accurate; the remaining work is **visual-flow + accuracy polish** (the layer
both plans opened with). Ranked, each with a concrete next step:

1. **On-device confirmation of Option B (aim-retarget).** Built + build-verified last
   session, distances confirmed this session, but the full Option B *interaction* (drag aim
   short of pin → whole readout retargets, elevation refetch to aim, F/C/B hide, "TO AIM"
   label) still wants a clean on-course pass. `POST-LAUNCH-TODO #25` (real on-course round
   on the native iOS shell) covers this.
2. **Premium-plan Phase 3 / bulletproof Phase 4.3 — Eagle Eye tokenization: Stage A+B
   ✅ SHIPPED 2026-07-02 PM** (commits `6fcbd72`/`e63ef0c`/`7add76f`; pixel-identical by
   verified contract — see [[synthesis/eagle-eye-tokenization-plan-2026-07-02]] §9).
   EagleEye.jsx color literals are gone (34-token `--tm-ee-*` palette). Remaining in this
   track: (a) on-device eyeball pass on the beta (low-risk residual), (b) Stage C value
   elevation + type/spacing scales (reviewed, with Matt), (c) next slices = the 34 other
   files sharing instrument literals — ⚠ HoleMapGL feeds MapLibre paint props where CSS
   `var()` does NOT resolve; that slice needs a getComputedStyle-at-init bridge, don't
   extend the codemod naively.
3. **Accuracy refinements on the shipped GPS gate — ✅ SHIPPED 2026-07-02 PM** (`d904347`;
   [[synthesis/range-rings-dispersion-build-spec-2026-07-02]]): honest dispersion zones
   (fixed 11-yd circle → dispersionEllipse model, soft + `~`-labeled), highlight-club arc
   dispersion band, and the held-2.5 rings as opt-in green-anchored layup arcs (the
   market-validated form — research killed player-centered concentric rings). Residual:
   on-device clutter/legibility pass. The hard marketing rule held: **no on-screen
   precision/±margin, no graded confidence chip** (Matt, 2026-06-30).
4. **Decide the principled tee-origin story (NOT urgent, do NOT act without Matt).** Today
   the map geometry + `teeOffset` reconcile to the scorecard. If we ever want the tee
   *marker* to sit exactly on the selected tee box, that's a real design conversation with
   Matt — it is NOT a bug to "fix" quietly.
5. **Wind/trajectory realism (deferred, sourced residual):** ideal plays-like scales wind by
   club/trajectory; the 250y carry cap is the pragmatic minimum-correct version. Only if Matt
   wants it.
6. **AI camera shot-analysis (ANALYZE) — PARKED, needs proper wiring before it's a feature.**
   The ANALYZE button was removed 2026-07-02 (`EagleEye.jsx`, commit `f6f5dfb`) because it was
   a broken entry point. The plumbing is intentionally left in place but unreachable:
   `CameraModal` + `POST /api/eagle-eye/analyze` + `ResultSheet`. To ship it: wire + verify the
   full flow end-to-end (camera → analyze → result), then re-surface a button. Also revisit the
   empty-state hero tagline **"AI-POWERED RANGEFINDER"** (`EagleEye.jsx:1914`) — a brand-copy
   call now that the AI camera feature is pulled.

## Bulletproof build plan — remaining open work (from the master checklist)

Phases 0–2, Track H (handicap), and Track F.1–F.6 + F.5 are **done/shipped**. Genuinely open:

- **Phase 3 leftovers:** ☐ 3.2 ad-free generous free tier · ☐ 3.4 green slope + putt-line ·
  ☐ 3.6 clean AR distance overlay.
- **Phase 4 — Polish (none started):** ☐ 4.1 skeletons + view transitions · ☐ 4.2 perf
  budgets + `content-visibility` · ☐ 4.3 Eagle Eye inline-style → token refactor.
- **Track F — security:** ☐ F.7 JWT revocation (`token_version`) · ☐ F.8 PIN brute-force
  rate-limit/lockout. *(Specced in `foundation-lock-build-spec-2026-06-27.md`.)*
- **Track F — native shell (TestFlight):** ☐ F.9 Info.plist location/camera usage strings
  (crash + hard rejection without them) · ◐ F.10 native sentinel (web done; native
  `window.__TM_NATIVE__` + `WKUIDelegate` pending). POST-LAUNCH #25/#26.
- **Track F — opportunistic:** ☐ F.11 scorecard privacy on `GET /rounds/:id` · ◐ F.12/F.13
  test-suite + link-target cleanup · ☐ F.14 split `Home.jsx`/`LiveOuting.jsx` god-files +
  `UserContext` + engineer README.
- **Operational/cost (not code):** migrate off free tiers → org Vercel Pro + Supabase Pro;
  satellite strategy; attribution surface; hold the marketing/accuracy stance.

When Matt greenlights the next slice, propose the phase, get his go, then build against the
App-Store bar in `CLAUDE.md`. North Star unchanged: **best golf app in the country,
App-Store-grade** — usability, accuracy, visual flow, Eagle Eye as the hero.

## Key files (for the next session)

- `client/src/pages/HoleMapGL.jsx` — map, aim line, segment labels, `teeOffset`,
  `emitAim`/`onAimChange`. **The distance logic here is working — leave it.**
- `client/src/pages/EagleEye.jsx` — HUD, plays-like mirror of `geo.js`, Option A/B,
  layout (centered hole toggle, bottom-center tee-distance card, right-rail ANALYZE,
  vignette, grain, gold glow).
- `client/src/lib/geo.js` — plays-like source of truth (sourced coefficients + carry cap).
  **Must stay byte-for-byte in sync with the mirror in `EagleEye.jsx`.**
- `client/src/lib/geo.test.mjs` — 31 assertions incl. plays-like carry-cap + hole-6
  regression. Gate.

## Gate before ANY push (beta discipline, from CLAUDE.md)

```
npm --prefix client run lint      # ESLint no-undef — catches server-only fns leaking to client
npm --prefix client run build     # build must be clean (NOT sufficient alone)
node client/src/lib/geo.test.mjs  # 31/31
npm test                          # vitest
```
Then commit + push to `main` (beta = `main`; features must be on `main` for Matt to test).
Never push broken code — a clean `vite build` still ships undefined-identifier runtime
crashes; lint is what catches them.

## End-of-session housekeeping status for THIS session

- Nothing was committed this session that isn't already on `main` from prior pushes — this
  session was diagnosis + confirmation; the label/distance changes were pushed earlier.
  **Next session: confirm `git status` is clean and `main` matches local before new work.**
- If wiki/CLAUDE.md changed, run the NotebookLM refresh + preflight per the CLAUDE.md
  end-of-session checklist.
