---
type: synthesis
created: 2026-07-06
updated: 2026-07-06
tags: [the-match, handoff, rollup]
---

# Handoff Rollup — single NotebookLM source for ALL session handoffs

One combined source so handoffs stop consuming individual slots against the
50-source cap (Matt's directive, 2026-07-06; same pattern as the Hub vault's
2026-05-03 cdaa7a43 prune). Individual handoff files stay in the repo as the
primary read path; this rollup is regenerated whenever a new handoff is
written (newest/ACTIVE first). Everything below the first section is
SUPERSEDED history — trust the ACTIVE section.






======================================================================
# [ACTIVE] next-session-handoff-2026-07-07.md
======================================================================

# Next-Session Handoff — 2026-07-07 (ACTIVE; supersedes 2026-07-06)

Start with the mandatory CLAUDE.md first actions (roll-call → wiki/index.md → this file +
`wiki/log.md`'s 07-06 PM13 → 07-07 AM4 entries). Everything below is SHIPPED AND
VERIFIED unless marked open.

## Shipped this session (07-06 PM → 07-07 AM; every item live + evidence-verified)

1. **Unification S4 COMPLETE** (`7f5902c`) — shared `components/scorecard/` surface (incl.
   PuttChips), both consumers import from it, defensive prop contracts (playerTeam default,
   value-or-fn diffStr/netDiffStr via perPlayer()). Browser-walked on solo AND multi
   (throwaway outing 7EAX). The whole solo/multi fork saga is closed: S1–S4 all live.
2. **Join intent > solo auto-resume** (`0084a16`) — ?join= QR/link lands in the match on
   first load; failed joins land on the hub where the error toast is visible.
3. **Eagle Eye outage — root-caused + 3 structural fixes.** Cause: 07-06 deploy-saga
   version skew let the browser HTTP-cache index.html UNDER the maplibre chunk URL
   (200 + cacheable). Fixes: (a) `/assets/*` excluded from SPA fallback (`b7a1ee4`) —
   missing assets 404, poisoning class closed, 8-route matrix verified; (b) map stall
   guard counts only VISIBLE time (`bdd6d92`) — Chrome freezes rAF when hidden/occluded;
   (c) poisoned entry healed; Matt confirmed EE renders. LESSON: map testing needs a
   VISIBLE browser window — occluded windows stall MapLibre 'load' by design.
4. **NotebookLM 50-source cap solved** — "Failed to get SOURCE_ID" = notebook FULL, not
   a broken CLI (anti-pattern #27 filed: same-target probes can't prove tool-wide
   failure). Handoffs now sync as ONE `handoffs-rollup.md` source (manifest
   exclude_paths); notebook at ~43/50; `--check-caps` preflight check added +
   regression-proven + synced byte-identical ×3 (the-match / Hub vault / LimitlessStack).
5. **Withdrawn provenance + rejoin reinstate** (`51ffe8e`) — traced the 7EAX mystery (no
   silent withdraw path exists; guard sheet or commissioner only), found the real bug:
   rejoining players stayed withdrawn. Now `withdrawn_by: self|host`; explicit re-join
   reinstates self-withdrawn; host authority preserved. 6/6 e2e vs prod.
6. **`react/jsx-no-undef` gate RE-LANDED** (`af059f3`) — first-landing killer reproduced
   under audit + root-caused: legacy-peer-deps skips peer AUTO-INSTALL → dropped
   @imgly's onnxruntime-web. Fixed: committed `.npmrc` (legacy-peer-deps=true — Vercel
   must resolve like local; plugin has no eslint-10 release), `onnxruntime-web` pinned
   EXACT 1.21.0 as direct client dep, rule regression-proven, clean-slate install with
   Vercel's exact command verified. ANY future npm install: lockfile-diff + clean-slate
   build remain mandatory.
7. **Progress docs updated**: `build-plan-bulletproof-2026-06-23.md` (Track G added —
   pipeline bulletproofing ledger; 4.3 flipped to ◐) and
   `eagle-eye-premium-plan-2026-06-23.md` (UPDATE 2026-07-07 block — dispersion bands,
   range-rings, tokenization A+B, Caddie all shipped).

## Open items, in priority order

1. **Matt's on-course round** (POST-LAUNCH #25 umbrella) — the field confidence check:
   putt chips both modes, ShotSheet, rings/dispersion clutter, tokenized EE, unified
   scorecard, and now withdraw/rejoin behavior.
2. **EE tokenization Stage C + HoleMapGL conversion** (build-plan 4.3 ◐) — use the
   `eeColor` bridge; MapLibre paint props don't resolve var().
3. **Visual-flow parity sweep** — solo/multi was only the START of the drift class Matt
   cares about; sweep other surfaces with fresh eyes.
4. **Dale housekeeping** — pull-review of 07-06→07 work (putt capture, unification,
   withdraw provenance touch his surfaces); drop dead `ods_` tables; revoke orphaned
   `the-match-prod` key.
5. **Retire old free-tier DB** ~after 2026-07-10 if the week stays clean.
6. **Caddie free-vs-Elite decision** + **ANALYZE un-park** (product calls).
7. Watch items: **Vercel deploy webhook** missed one push (empty-commit retrigger works;
   escalate if it repeats) · **participant-change audit trail** gap (operator-console
   era) · throwaway outing 7EAX + scratch league entries can be DB-cleaned whenever ·
   Hub vault has ONE pre-existing uncommitted file (tools/.notebooklm-opensalon-state.json)
   awaiting Matt's call.

## Environment facts (current as of `af059f3`+)

Prod `the-match-roan.vercel.app` (alias verified Ready, /health db:true) · DB OSL
"Open Design Studio" bqjd… :6543 transaction pooler · `.npmrc` legacy-peer-deps=true is
COMMITTED (required for eslint-plugin-react on eslint 10) · onnxruntime-web pinned 1.21.0
direct · all SCORING_* flags on · ANTHROPIC_API_KEY the-match-prod-2 · test accounts #2/#14,
outings 8L3U/UDCX closed-keep, 7EAX throwaway · e2e harness scripts/e2e-putt-capture*.mjs.

## Process rules carried forward (all bit us within 48h)

Served-bundle gate (vercel inspect + content grep) · lockfile diff + clean-slate install
on ANY npm install · browser-walkthrough with a VISIBLE window for map work · SW-activation
reload races the first post-deploy page load (retry before diagnosing) · slice definition
defines done · same-target probes prove nothing tool-wide (anti-pattern #27).


======================================================================
# [SUPERSEDED] next-session-handoff-2026-07-06.md
======================================================================

# Next-Session Handoff — 2026-07-06 (SUPERSEDED by 2026-07-07)

Start with the mandatory CLAUDE.md first actions (roll-call → wiki/index.md → this file +
`wiki/log.md`'s 07-02→07-06 entries). This was a marathon multi-day session; the log has
per-item detail. Everything below is SHIPPED AND LIVE unless marked open.

## Shipped this session (all browser- or data-verified)

1. **Eagle Eye tokenization Stage A+B** — 34-token `--tm-ee-*` palette, pixel-identical
   (244/244 equivalence). `eagle-eye-tokenization-plan-2026-07-02.md` §9.
2. **Range-rings + dispersion zones** — honest dispersionEllipse landing zones, opt-in
   green-anchored layup rings, `eeColor` getComputedStyle bridge for MapLibre paint
   (REQUIRED for any future HoleMapGL color work — paint props don't resolve var()).
3. **SG v2 (Dale's PR #1) MERGED** — SG engine, Stats card, Practice signals, AI Caddie
   (model `claude-sonnet-5`, env override `CADDIE_MODEL`; robust text-block extraction —
   content[0] is NOT guaranteed text). Caddie confirmed answering from Matt's real bag.
4. **Prod DB moved** to OSL org (Pro), project "Open Design Studio" `bqjdiixkygslaryxcyfg`,
   us-east-2, nightly backups. ⚠ THE LESSON: Vercel `DATABASE_URL` must be the
   **transaction pooler (:6543)** — session (:5432) exhausted its 15-client cap and took
   the beta down (EMAXCONNSESSION). Local .env stays :5432 for dev.
5. **Anthropic billing** — company org (Dale owner, Matt admin, $100 prepaid ceiling);
   live key = `the-match-prod-2` (validated by 200-probe BEFORE install).
6. **Live putt capture in outings** (self-score only; writer===target enforced both
   endpoints; migration 041 on prod) — `live-putt-capture-outings-build-spec-2026-07-06.md`.
   e2e-verified vs prod (scripts/e2e-putt-capture*.mjs, test outing 8L3U).
7. **Solo/multi scorecard unification COMPLETE (S1–S3)** — solo renders the SAME
   ScorecardTable/TotalsRow/MatchScoreboard/LeadersPlaque/AugustaPlaqueFooter as outings,
   one row, no filler rows, chrome pinned full-width with the grid scrolling between.
   Zero Solo* scorecard components remain. `solo-multi-scorecard-unification-spec-2026-07-06.md`.

## Open items, in priority order

1. ~~**Unification S4**~~ ✅ SHIPPED 2026-07-06 PM (`7f5902c`, deploy verified Ready; browser walkthrough still owed) — move shared scorecard components (incl. PuttChips pattern) to
   `components/scorecard/`, BOTH consumers import from there, and add defensive default
   props: `playerTeam = () => null`, `diffStr`/`diffColor` accepting value-or-fn,
   `skinsByPlayer = {}`. Separate commit (bisection). The two prop-contract crashes on
   07-06 are the motivation — make them structurally impossible.
2. **Re-land the `react/jsx-no-undef` lint gate** — the fix is known-good (regression-
   proven to catch the PuttChips crash class) but its first landing churned the lockfile
   and DROPPED `onnxruntime-web`, breaking Vercel builds. Redo: install plugin, then
   verify `npm install` from a CLEAN node_modules builds, diff the lockfile for dropped
   packages (grep onnxruntime), THEN commit. The `.npmrc`/overrides attempts were reverted.
3. ~~**One glance at a real multiplayer match**~~ ✅ DONE 2026-07-06 PM (throwaway outing 7EAX) — plaque/footer confirmed structurally
   unchanged (verbatim component swap, diff-verified) but not eyeballed on a live match.
4. **Matt's on-course round** (POST-LAUNCH #25 umbrella): putt chips both modes, ShotSheet,
   rings/dispersion clutter check, tokenized EE eyeball, unified scorecard in the field.
5. **Dale housekeeping**: pull-review of 07-06 work (putt capture + unification touch his
   SG + solo surfaces); drop dead `ods_` tables in the DB project; revoke orphaned
   never-used `the-match-prod` key.
6. **Retire the old free-tier DB** (~after 2026-07-10 if the week stays clean; old
   connection string is commented in Matt's .env).
7. **ANALYZE un-park decision** — root causes all fixed (key + extraction); needs a
   product call + end-to-end camera pass before re-surfacing the button.
8. Carried forward: EE Stage C (reviewed value elevation), Phase 4.3 other-file
   tokenization (use eeColor bridge for HoleMapGL), Caddie free-vs-Elite at launch,
   solo/multi scorecards were only THE START of visual-flow parity — Matt cares about
   this class of drift; sweep other surfaces with fresh eyes.

## Hard-won process rules (enforce these — they all bit us this session)

- **"Deployed" = the SERVED bundle hash changed + content verified** (curl the asset).
  `vercel ls` deploys can silently Error while local gates are green.
- **Browser-walkthrough loop with Matt logged in is the highest-value QA in the stack** —
  it caught 4 issues automated gates structurally couldn't. Hard-refresh (cmd+shift+r)
  after every deploy; the SW serves stale bundles otherwise.
- **Any npm install → diff the lockfile + build from clean node_modules before commit.**
- **Shared-component prop contracts**: several LiveOuting scorecard props are FUNCTIONS
  called per-player; passing values crashes. Until S4 hardens defaults, check the call
  census (grep `prop(`) before wiring a new consumer.
- **The slice definition defines done.** Matt caught three quiet scope-narrowings in one
  night. Claims of completion must match the written scope, verbatim.
- **Verify against the actual DDL/objects** (the migrations-check false alarm) and
  **validate secrets by live probe BEFORE installing** (the key saga).

## Environment facts (trust anchors current as of `6eaed06`+)

CLAUDE.md is up to date (DB section, 42 migrations, SG v2 note). Wiki synced to
NotebookLM (verify_failed 0 throughout). Prod: Vercel `the-match-roan.vercel.app`,
DB OSL/bqjd :6543, ANTHROPIC_API_KEY = the-match-prod-2, all SCORING_* flags on.
Test accounts: #2 Test User, #14 Demo Tester; test outings 8L3U/UDCX (closed, keep).
e2e harness: `scripts/e2e-putt-capture*.mjs` (JWT minted blind from .env).


======================================================================
# [SUPERSEDED] next-session-handoff-2026-07-02.md
======================================================================

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


======================================================================
# [SUPERSEDED] next-session-handoff-2026-06-30.md
======================================================================

# The Match — Next-Session Handoff (2026-06-30)

Supersedes `next-session-handoff-2026-06-29.md`. Read this first.

## What shipped this session (all on `main`, build+lint+test-gated, Matt device-checked)
Six commits, in order:
1. **`e5aef08` — reduced-motion accessibility pass** (`tokens.css`): global `prefers-reduced-motion` block that cuts looping/decorative motion + smooth-scroll and snaps entrances to their final visible state, but PRESERVES the opacity-led confirmations (the "✓ Saved" chip + score-event banner) so reduced-motion users still get feedback. Saved-chip animation exposed as `.tm-anim-saved` for this. Honors iOS Reduce Motion in WKWebView.
2. **`587999d` — removed the on-screen GPS "±X m" margin** (3 spots: Eagle Eye HUD trusted + acquiring chips, ActiveRound solo pill). Matt: showing the error figure narrates the flaw. Now a calm "GPS"/"ACQUIRING" only. **The accuracy gate is unchanged** — `coords.accuracy` still suppresses a bad fix internally.
3. **`4d13c9d` — plays-like wind applies pre-fix** via a tee→green geometry-bearing fallback for `shotBearing` (was null without a live GPS fix → wind silently 0 on the FROM-TEE view). Now wind is considered before and during the round.
4. **`5002848` — header wind arrow made shot-relative** (rotate by `wind.dir − shotBearing`) so the same real wind reads differently per hole.
5. **`975fefc` — wind arrow flipped to blow-direction** (`+ 180`): DOWN = in your face (headwind), UP = at your back toward the pin (tailwind). Display-only; math unchanged.
6. **`a2f5b73` — plays-like coefficient REBUILD** — the big one (below).

## Plays-like rebuild (the accuracy headline)
Matt found hole 6 (335 yd) showing "plays like −36" — physically absurd. Root cause: the plays-like model was an **unvalidated in-house heuristic** (symmetric wind, folk 2%/1000ft altitude, symmetric elevation). Rebuilt `computePlaysLike` (in **both** mirrored copies — `client/src/lib/geo.js` + `client/src/pages/EagleEye.jsx`) with **sourced, physically-defensible coefficients** (Trackman / Titleist R&D):
- Wind **ASYMMETRIC**: headwind +1.0%/mph, tailwind −0.5%/mph (~2:1). *This was the −36 bug — a tailwind was over-credited 2×.*
- Altitude 1.16%/1000 ft (was 2%). Temp 0.8%/10°F @70°F (was 1%). Elevation downhill ×0.67 of uphill (was symmetric).
- Per-channel caps (App-Store robustness). Additive by design so the transparency UI's four factors still sum to the total.
- Pinned by **29 passing assertions** in `client/src/lib/geo.test.mjs` (incl. the hole-6 regression → now ≈ −20). Run: `node client/src/lib/geo.test.mjs`.
- Full sourced spec + every citation: `playslike-accuracy-rebuild-2026-06-30.md`. Also caught + avoided an inverted density factor in the research agent's sample JS.

## CORRECTED marketing/UX stance (supersedes the old carve-out)
The build-plan used to say "the in-app ±X m chip is a UX trust signal, not a marketing claim." **That is now wrong.** Matt's ruling 2026-06-30: **never show an error/precision figure anywhere — not in marketing AND not in-app.** Showing "±X m" narrates the flaw on every shot. The app shows only a calm "GPS"/"ACQUIRING" state. **Do NOT re-add an on-screen margin. Do NOT build a "graded confidence chip"** (an earlier idea, explicitly rejected). The accuracy gate stays internal (`coords.accuracy`).

## Phase 0 (visual foundation) — real status (corrects the old "NONE done")
The 2026-06-23 pass had already: enabled tabular numerals app-wide, and defined dark-elevation + layered-shadow + glass + motion tokens. This session verified/added:
- **WP-0.A tabular numerals — DONE/verified** (already applied via `body` inheritance incl. SVG; no override disables `tnum`).
- **WP-0.E reduced-motion — SHIPPED** (commit 1 above).
- **WP-0.C dark elevation, WP-0.D shadows/palette, WP-0.F grain — DEFERRED, not done.** Audit finding: the app is heavily **inline-styled** (176 inline `boxShadow` across 40 files; the `Card` primitive is imported nowhere; Eagle Eye is already glass), so "change a token, lift the app" does NOT work — these are a Phase-4.3-class per-element refactor with low visible payoff and real regression risk on the beta. Recommended: don't grind them; do any visual polish surgically with Matt's device in the loop. Full reasoning: `phase0-foundation-build-spec-2026-06-30.md`.
- **Font decision: keep system SF Pro** (Matt reviewed a 4-way mockup, `font-comparison-mockup.html`; a custom font was "a reach"). No custom font — removes the biggest WKWebView risk.

## Open items (small, Matt's call)
- **Dial vs arrow wind convention:** the header arrow now shows blow-direction (down=headwind); the dial in the PLAYS-LIKE sheet still shows a source-marker (top=headwind). Both labeled/correct but opposite — align if desired.
- **Dogleg "distance to the pin":** on the tee, the base uses the scorecard hole yardage; on a dogleg the straight-line to the green is shorter. Option to switch to the GPS-measured straight-line (true to-pin) — not yet done.

## Strategic recommendation carried forward
We're already visually ahead of the field (research-confirmed: no competitor documents tabular numerals, an elevated/material HUD, or a validated plays-like). The highest-leverage remaining work is **functional/accuracy/App-Store**, not more visual churn: accuracy polish (done a big one this session), and the App-Store blockers + security in Track F (F.9 Info.plist usage strings — native shell, NOT in this repo; F.7 JWT revocation, F.8 PIN lockout — server-side, self-verifiable). See `build-plan-bulletproof-2026-06-23.md` Track F.

## Standing rules (unchanged)
Roll Call first. Beta = `main` (gate every push: `npm --prefix client run build` + `run lint` + `node --check` changed server files + `npm test`; math via `node client/src/lib/geo.test.mjs`). audit-before-claim every claim. Framing check (anti-pattern #26). Never advertise/​show a precision figure.


======================================================================
# [SUPERSEDED] next-session-handoff-2026-06-29.md
======================================================================

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


======================================================================
# [SUPERSEDED] next-session-handoff-2026-06-28.md
======================================================================

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


======================================================================
# [SUPERSEDED] next-session-handoff-2026-06-27.md
======================================================================

# The Match — Next-Session Handoff (2026-06-27)

*Supersedes `next-session-handoff-2026-06-26.md`. Read this first, then the two living plans: `build-plan-bulletproof-2026-06-23.md` (the checklist) and `eagle-eye-premium-plan-2026-06-23.md` (the design thesis). Both still current through 2026-06-26.*

## Where things stand (one paragraph)

The leapfrog + handicap tracks are in great shape: **3.1 plays-like**, **3.3 own-club arcs**, **3.5 data→practice loop**, and the whole **WHS handicap engine (through H.6)** are shipped and device-verified. This session did three things on top of that: (1) **finished the practice loop to full quality** — it's now genuinely interactive (drill detail sheets, a guided Start-Session runner, a closed-loop re-measure display), not the read-only v1; (2) **rebuilt Eagle Eye's distance arcs as real whole-bag arcs** with collision-aware labels; and (3) took a long run at **Eagle Eye full-bleed / true edge-to-edge** in the home-screen PWA — which we **deliberately deferred to the native build** after pinning the root cause. The beta (`main` → Vercel) is **green and stable**; the bottom nav, viewport meta, and Eagle Eye are back to known-good, with the temporary on-screen diagnostic removed.

## What shipped this session (2026-06-26 PM → 2026-06-27)

**Practice loop — finished to full quality (Phase 3.5 polish).** The v1 was a read-only panel; Matt's bar is "#1 app, nothing half-done." Now:
- Portal the overlay to `document.body` so it actually opens above the transformed tab shell (`5755ee4`).
- Fully interactive: tappable drill detail sheets with how-to, a guided **Start-Session runner**, and a **closed-loop** "re-measure next round" display (`49e0290`, `9eeaa3f`).
- Distinct drills per focus area — killed a bug where two areas showed identical drill sets (`264943f`); single close button on runner step 1 (`27e178c`); neutral labels for low-severity tracked areas (`75dc64b`); premium + design-audit visual pass (`bb355a5`, `25af026`).
- Verified accurate by independent recompute (blow-up %, par-type splits, hard-hole splits all matched the engine).

**Eagle Eye own-club arcs — rebuilt (`20da4f3` + label passes `86165fa`/`7264a75`/`3c9f3e1`).** Real whole-bag distance arcs on the GL hole map (not own-club-only), with collision-aware labels that flip out of the distance-card zone and spread to the arc end so they don't overlap. `client/src/lib/clubModel.js` (+ `__tests__/clubModel.test.mjs`).

**Eagle Eye full-bleed — attempted, DEFERRED to native (see POST-LAUNCH-TODO #24).** A long sequence (fullscreen restructure, tab-bar removal on Eagle Eye, `position:fixed` shell, a `ResizeObserver` on the GL canvas, safe-area inset expansion, viewport-meta experiments) trying to kill the bottom home-indicator strip. **Root cause pinned:** the iOS **standalone PWA shrink-fits the `100dvh` layout** (measured `innerWidth=459` vs Safari's correct `390` on the same device), which produces the bottom strip, a Safari-vs-app zoom mismatch, AND the sign-in keyboard not popping on first tap — all one root cause. No web-side lever fixes it without breaking the nav. **It does not exist in the native WKWebView shell** (the App Store target), so it's parked there. Beta reverted to known-good (`aa02212`); diagnostic removed.

**Kept (benign/correct, survived the revert):** `HoleMapGL` `ResizeObserver` (`f3cb393` — canvas now tracks its container), bottom-nav safe-area padding + `--nav-height` including the inset, and the Login fairway photo moved to its own fixed layer (cleaner; the original `background-attachment:fixed` is a known iOS touch-bug source).

**Reverted (experiments that destabilized):** viewport-meta changes (`minimum-scale`, dropping `user-scalable`/`maximum-scale`) → restored original; Eagle Eye 4-edge/bottom inset expansion → back to `inset:0`; on-screen `SafeAreaProbe` → removed.

Commits: `bb355a5`→`4b15d9f`. build + lint + `node --check` clean throughout. Beta `main` green.

## Pick up next — ranked

1. **Eagle Eye premium-plan, remaining Phase-0 / Phase-3 items** (design thesis in `eagle-eye-premium-plan-2026-06-23.md`):
   - **Phase 0 foundation** (still ☐ in the build plan): dark-elevation + layered-shadow tokens (0.1), type system + the mono "instrument" numerals (0.2), motion-discipline pass (0.3). Highest perceived-quality-per-hour, low risk, whole-app lift.
   - **Eagle Eye control system:** the audit flagged four competing floating islands (ANALYZE / BAG / hole pill / distance card). Unify into one coherent spatial system + matching premium icon buttons for ARCS/BAG. (Lower priority than Phase 0; pure polish.)

2. **Next Phase-3 leapfrog — Matt's pick.** Shipped: 3.1, 3.3, 3.5. Remaining: **3.2** ad-free generous free tier · **3.4** green slope + putt-line (needs a credible contour data source) · **3.6** clean AR distance overlay.

3. **App-Store packaging pass (when ready) — this is where the safe-area work lives now.** POST-LAUNCH-TODO **#24**: in the WKWebView shell set `contentInsetAdjustmentBehavior = .never` + drive insets natively → the bottom strip, the zoom mismatch, and the first-tap keyboard all resolve together. Verify on a real device in TestFlight.

4. **Operational / pre-launch (not code):** migrate the-match onto the org's existing Vercel Pro + Supabase Pro (off free tiers); confirm the attribution surface (OSM + vector tiles + fonts + NAIP); hold the marketing accuracy stance (never claim "laser"/precision margins).

5. **(Greenlit earlier, still open) Security hardening:** write up the JWT/PIN review as a wiki doc + implement PIN brute-force hardening (shared-store rate limit + account lockout; current limiter is in-memory and unreliable on serverless). 90-day JWT has no revocation.

## Hard-won lesson from this session (don't repeat)

**Do not pixel-chase iOS-standalone-PWA safe-area/viewport quirks by blind-deploying to the device.** The home-screen PWA renders differently from Safari and from the native shell; web-side viewport levers (`minimum-scale`, inset expansion, cover toggling) either don't move it or break the nav. When something looks like an OS-rendering quirk: **measure on-device first** (an on-screen `innerWidth`/`innerHeight`/`safe-area` readout settled this in one screenshot), and if it's standalone-only, **defer to the native shell** rather than thrashing the beta. This cost most of a session; the deferral was the right call once the root cause was measured.

## Standing rules for next session (don't relearn the hard way)

- **Roll Call first** (`roll-call` skill / `tools/limitless-preflight.sh`), then read `wiki/index.md` + the most recent `wiki/log.md` entry.
- **Beta discipline:** `main` IS the test surface — build-verified feature code goes to `main`. The gate is **build AND lint** (`npm --prefix client run build` + `run lint` + `node --check` on changed server files). Lint (`no-undef`) catches ReferenceError-class scope bugs a clean `vite build` will happily ship.
- **No PWA viewport-meta changes** — they destabilize the beta nav for zero product benefit. Safe-area is a native-shell concern (#24).
- **Migrations** are append-only, applied by hand via `psql "$DATABASE_URL" -f migrations/0NN_*.sql` (now through 034 — practice logs).
- **Mobile-first** everywhere EXCEPT leagues/commissioner surfaces (desktop too).
- **Handicap engine is the single source of truth:** `maybeUpdateUserHandicap` writes the persisted index; `stats.js` reads it (never recompute divergently).

## Key files (this session's surfaces)
- `client/src/pages/Practice.jsx` — interactive practice surface (drill sheets, session runner, closed loop).
- `server/src/lib/practice.js`, `server/src/routes/practice.js`, migration **034** (`tm_practice_logs`).
- `client/src/lib/clubModel.js` (+ `__tests__/clubModel.test.mjs`) — whole-bag distance arcs.
- `client/src/pages/EagleEye.jsx` — hero rangefinder (back to known-good `inset:0` root).
- `client/src/pages/HoleMapGL.jsx` — GL hole renderer (now with `ResizeObserver`).
- `wiki/POST-LAUNCH-TODO.md` **#24** — the native safe-area fix.


======================================================================
# [SUPERSEDED] next-session-handoff-2026-06-26.md
======================================================================

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


======================================================================
# [SUPERSEDED] next-session-handoff-2026-06-24.md
======================================================================

# The Match — Next-Session Handoff
*Written 2026-06-24 (end of a long Cowork session). Read this, then the two plan docs alongside it in `wiki/synthesis/`.*

---

## 0. Start here (before any work)
1. **Run Roll Call** (`roll-call` skill → `tools/limitless-preflight.sh`). Don't start substantive work until READY.
2. **Read the plan docs (same `wiki/synthesis/` folder):**
   - [[synthesis/build-plan-bulletproof-2026-06-23]] — phased build + zero-cost stack + progress checklist (Phase 1 + 2 ☑).
   - [[synthesis/eagle-eye-premium-plan-2026-06-23]] — design/Eagle-Eye vision.
3. **Read `the-match/wiki/log.md`** top entry (2026-06-24, "Phase 2.1/2.2 SHIPPED — MapLibre sole renderer") for the full detail of what shipped.
4. Beta discipline unchanged: `main` auto-deploys and **is** the test env. Every change → `npm --prefix client run build` + `lint` + `node --check` (server) → push to `main` → Matt verifies on his iPhone.

> **🎯 This is a NATIVE iOS App-Store app** (WKWebView shell). iOS 15+ → WebGL2 guaranteed. NEVER write browser-framed fallbacks. Every decision = App-Store-readiness. (See the callout at the top of `the-match/CLAUDE.md`.)

---

## 1. Where things stand (what shipped this session)
- **Phase 1 (correctness/cost-safety): ✅ all shipped + verified.** GPS accuracy gate (1.1), durable Supabase OSM cache (1.2, migration 028), ESRI→**USDA NAIP** imagery (1.3).
- **Phase 2 (hero instrument): ✅ shipped + device-verified.** Distance instrument (arc gauge + number roll), glass HUD, smooth puck + accuracy halo.
- **MapLibre GL is the SOLE hole-map renderer — Leaflet fully removed (~800 lines).** NAIP base + branded vector overlays, course-up, cinematic flyTo (pitch ~62°), draggable aim point + split yardage pills, per-club landing-zone ring, tap-to-measure, real OSM green polygons, adaptive zoom.
- **Offline tile caching is live** — MapLibre `addProtocol('naipc://')` → Cache API (`naip-tiles-v1`, FIFO 2000). A loaded hole keeps imagery with zero signal. + chunk-load auto-retry + graceful retry card on genuine failure.
- **Lifecycle fixes:** markers no longer vanish on course switch (null marker refs on teardown); pull-to-refresh disabled on the map; F/C/B only from a trusted GPS fix.

The tee/green/course-layout intelligence (OSM fetch + matching + default aim) lives in `EagleEye.jsx` + `lib/geo.js` + the server — **renderer-agnostic**; the Leaflet removal didn't touch it.

---

## 2. Recommended pick-up order (Phase 3 — leapfrog features)
These are the strategic moat. Sequence by Matt's appetite (confirm at session start):
1. **3.1 Transparent, adjustable plays-like (free)** — hero plays-like number you tap to break into wind / elevation / temp, each overridable. The single biggest category gap. (`computePlaysLike` in `lib/geo.js` already does the base math.)
2. **3.3 Own-club distance arcs** — draw the player's club averages as arcs on the map (ties into the bag model + the landing-zone ring already built).
3. **3.2 Ad-free generous free tier** — strategic positioning decision as much as code.
4. **3.4 Green slope + putt-line** · **3.5 data→practice loop** · **3.6 clean AR** — bigger lifts.

Then **Phase 4 polish** (skeletons, perf budgets, Eagle Eye inline-style→token refactor) and the **operational/cost decisions** (migrate the-match onto the org's Vercel Pro + Supabase Pro; confirm attribution surface; set the "~3–5 yd, never laser" marketing promise).

One small held item: **concentric yardage range-rings** on the map (held pending a live-map clutter judgment).

---

## 3. Known gotchas / lessons (save yourself the pain)
- **DOM checks are ground truth; screenshots are NOT.** In the Chrome-MCP test tab, screenshots lag/cache (showed stale frames repeatedly) and the console replays errors from old bundles. To verify the map: query `document.querySelectorAll('.maplibregl-canvas').length`, `.leaflet-container`, `caches.open('naip-tiles-v1')`, etc.
- **NAIP throttles a hammering IP.** After ~40 test reloads the USDA NAIP server (`gis.apfo.usda.gov`) started timing out *my* burst tile requests (a single fetch still worked). It self-recovers. Don't conclude "the map is broken" from repeated reload failures — verify on Matt's device. Real-user safety net: offline cache + 20s load-timeout + retry card.
- **MapLibre raster `addProtocol`:** return `{ data: ArrayBuffer }` of the encoded JPEG **file bytes** (not pixels) — per maplibre-gl discussion #4480. A service worker does NOT work for tile caching (MapLibre fetches tiles from its worker thread, which the SW can't intercept).
- **MapLibre lifecycle:** `map.remove()` destroys all DOM markers — null EVERY marker ref on teardown or they won't re-create on the next map (the course-switch bug).
- **`api.x` vs `api.x.y()` shadowing**, **String-coerce both sides of id compares**, **don't drive-by refactor** — standing repo conventions.

---

## 4. Key files
- `the-match/client/src/pages/EagleEye.jsx` — Eagle Eye shell, HUD, distance instrument, OSM fetch/matching, course picker. Renders `<HoleMapGL>` directly now.
- `the-match/client/src/pages/HoleMapGL.jsx` — the MapLibre renderer (all map overlays, flyTo, puck, aim, landing, offline tile `addProtocol`).
- `the-match/client/src/lib/geo.js` — haversine, bearing, plays-like, green F/C/B, polygon matching (renderer-agnostic geometry).
- `the-match/server/src/routes/eagle-eye.js` — OSM/Overpass proxy + Supabase cache (migration 028 `tm_osm_cache`).
- `the-match/client/public/sw.js` — PWA service worker (push + cache-sweep + per-deploy stamp). **Do NOT add tile caching here** (worker-thread bypass; use `addProtocol`).

---

## 5. End-of-session checklist (for when YOU wrap)
`wiki/log.md` entry → refresh trust anchors (CLAUDE.md / index.md) → commit+push `the-match` → `python3.11 tools/notebooklm-wiki-refresh.py` → verify `verify_failed: 0` → preflight green.


======================================================================
# [SUPERSEDED] eagle-eye-tile-grid-handoff-2026-05-01.md
======================================================================

# Handoff — Eagle Eye satellite tile grid lines (open issue)

**Created:** 2026-05-01 — end of session
**Status:** unresolved after multiple CSS attempts

## TL;DR

The satellite map in The Match's Eagle Eye tab shows visible grid lines between tiles. Multiple fixes attempted, none have closed the gap. Root cause is most likely the **leaflet-rotate plugin** introducing fractional-pixel positioning when the map rotates course-up — adjacent satellite tiles end up with sub-pixel seams that paint as visible lines.

## What's been tried (in order)

All changes scoped to `client/src/pages/EagleEye.jsx` inside the inline `<style>` block near line 1650.

1. **`background: #070C09 !important` on `.leaflet-container`** — Changed gap color from white (Leaflet default `#ddd`) to dark green to match the page. **Result:** gaps still visible, just dark instead of light.
2. **`outline: 1px solid transparent` on `.leaflet-tile`** — Hoped this would force the browser to rasterize tile boundaries cleanly. **Result:** no visible effect.
3. **`transform: scale(1.01)` on `.leaflet-tile` + `transform-origin: 0 0`** — Slight oversample so adjacent tiles physically overlap by ~1 pixel. **Result:** Matt reports lines still showing.
4. **`backface-visibility: hidden` + `transform: translateZ(0)` on `.leaflet-tile-pane` and `.leaflet-tile`** — Force GPU compositing to kill sub-pixel CPU rasterization seams. **Result:** combined with #3 above, still visible.
5. **`will-change: transform` on `.leaflet-tile`** — Compositing layer hint. **Result:** no improvement.

Current CSS in the file (lines ~1665-1690):

```css
.leaflet-container { background: #070C09 !important; }
.leaflet-tile-pane {
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  transform: translateZ(0);
}
.leaflet-tile {
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  will-change: transform;
  transform: scale(1.01);
  transform-origin: 0 0;
}
```

## Likely root cause

The leaflet-rotate plugin (loaded from CDN at runtime, version 0.2.8) applies `transform: rotate(<bearing>)` to the entire map pane. When rotation is non-axis-aligned (anything other than 0°/90°/180°/270°), each tile's position is computed in fractional pixel coordinates. The browser anti-aliases the tile edges against whatever's beneath. Even with the container background matching the page, the anti-aliasing creates a visible darker line at the rasterization boundary.

The `scale(1.01)` trick *should* have worked because it makes tiles physically overlap. The fact that it didn't suggests one of:
- The rotate plugin's per-tile transform is overriding or composing with my scale in a way that cancels the overlap
- iOS Safari is anti-aliasing each tile independently before compositing, so the seam line remains visible across tiles regardless of overlap
- The grid lines aren't actually inter-tile seams but something else (e.g., a leaflet debug overlay, a CSS rule from a library, etc.)

## What to try next (ranked)

1. **Inspect computed CSS in iOS Safari dev tools.** Connect Matt's iPhone to a Mac running Safari, open Develop → his iPhone → the-match tab, inspect a `.leaflet-tile` element. Check what transforms are *actually* applied. The `scale(1.01)` may be getting clobbered by the rotate plugin's per-tile transform.

2. **Try `tileSize: 257` in the `L.tileLayer` config.** Forces tiles to render slightly oversized at fetch time, which is conceptually similar to `scale(1.01)` but applied at the source. Less likely to be clobbered:
   ```js
   // EagleEye.jsx line ~323:
   L.tileLayer(url, { tileSize: 257, zoomOffset: 0, ... })
   ```
   Image gets stretched 0.4% — invisible at any zoom. Will close ~1px seams.

3. **Pin a newer leaflet-rotate version.** Currently `leaflet-rotate@0.2.8`. Check `https://github.com/Raruto/leaflet-rotate` for newer releases that may have fixed the tile-seam issue. Note the inverted-bearing bug we worked around in `wiki/synthesis/...` — if you bump the version, re-test orientation.

4. **Disable rotation as a test.** Toggle off the rotate plugin's `bearing` and verify the grid lines disappear entirely. That confirms rotate is the cause. If they persist with no rotation, it's an unrelated rendering bug.

5. **Switch to Mapbox satellite tiles.** ESRI World Imagery is current. Mapbox handles fractional-pixel positioning more robustly per leaflet GH issues. Would need a `MAPBOX_TOKEN` in env.

6. **Add 1px box-shadow inset matching page bg.** Wraps each tile in a subtle border that matches the gap color, so the seam visually merges with tile content edges.

## What's working (don't break these)

- Onboarding wizard runs on signup; mandatory through step 4 (driver). Profile + bag + course + handicap save correctly via `POST /api/profile/update` and `PUT /api/clubs/bag/driver`.
- Home checklist renders + auto-finalizes onboarding when all five items complete.
- Coach marks fire once per user per id on Home, Match, Eagle Eye, My Bag, Profile, PlayerCard. Tour mark intentionally removed.
- Admin gear icon shows for `mlav1114@aol.com` only; opens user roster newest-first.
- Bag toggle on Eagle Eye picks closest club to GPS distance, ▲/▼ cycles, pulsing yellow target on map at projected landing point.
- Match page swipe-left-to-delete works on host's own active matches.
- Tour page renders position, TOT, THRU correctly from new ESPN scoreboard shape.

## File inventory (everything touched this session, all pushed)

- `client/src/pages/EagleEye.jsx` — bag toggle, landing zone marker, yardage card resize, conditions pill cleanup, **tile CSS attempts (this issue)**
- `client/src/pages/Outing.jsx` — swipe-to-delete, expected_players, coach mark
- `client/src/pages/MyBag.jsx` — bag inventory + distance, "+ Other" custom entry, bag complete overlay
- `client/src/pages/Home.jsx` — admin gear, onboarding checklist, profile coach mark, dark calendar
- `client/src/pages/PGAScores.jsx` — ESPN scoreboard shape fix
- `client/src/components/OnboardingWizard.jsx` — new
- `client/src/components/OnboardingChecklist.jsx` — new
- `client/src/components/CoachMark.jsx` — new
- `client/src/components/AdminUsersModal.jsx` — new
- `client/src/components/RivalryDetail.jsx`, `RivalryHistory.jsx`, `FriendProfile.jsx`, `PlayerCard.jsx` — various tweaks
- `client/src/components/BagPhoto.jsx` — created + reverted (file still in tree, unused)
- `client/src/lib/clubCatalog.js` — new
- `migrations/009_tm_user_clubs.sql`, `010_tm_user_clubs_avg_yards.sql`, `011_tm_outings_expected_players.sql`, `012_tm_users_onboarding.sql` — all applied to prod
- `server/src/routes/clubs.js`, `onboarding.js`, `admin.js` — new
- `server/src/routes/outings.js`, `availability.js`, `games.js`, `auth.js`, `profile.js` — additions

## Tell next-Claude

> Eagle Eye's satellite tiles show visible grid lines between adjacent tiles. The leaflet-rotate plugin is the proximate cause. Five CSS attempts have failed: container bg match, transparent outline, `scale(1.01)`, GPU compositing, will-change. Read `HANDOFF-2026-05-01.md` for full list. Start with **iOS Safari dev tools inspection** of the actual computed transforms on `.leaflet-tile`, then try **`tileSize: 257`** in the tileLayer config (high success rate, low risk), then try a **leaflet-rotate version bump**. Don't re-attempt the fixes already in `EagleEye.jsx` — they're documented as unsuccessful.
