# Next-Session Handoff — 2026-07-10 (ACTIVE; supersedes 2026-07-09)

Mandatory start: **roll-call → wiki/index.md → this file + latest `wiki/log.md` entries**
(PM1–PM9 for this session), then the two live specs:
[[synthesis/play-funnel-phase1-build-spec-2026-07-10]] and
[[synthesis/play-oncourse-phase2-build-spec-2026-07-10]].

## TL;DR
Massive build day, session-start-to-finish with Matt device-testing live. **Phase 0
(nav restructure), Phase 1 (Play start funnel), and Phase 2 (active-round session +
QuickScoreSheet + GPS nudge) of the start-match-unified-flow plan ALL SHIPPED to the
beta**, plus ~10 device-pass fixes from Matt's live feedback. One reverted regression
(geometry trust gate). Everything gated (build + lint, now incl. a new TDZ rule);
runtime verification of Phase 2 is Matt's ongoing device pass.

## THE NEXT BUILD — "Map this course" editor (Matt greenlit, top priority)
Bayonne proved OSM's tee/green matching can be SYSTEMATICALLY wrong (hero FROM TEE
365 = scorecard truth vs drawn line 229 = wrong OSM point; the reverted gate showed
MANY Bayonne holes fail card-vs-drawn verification). The permanent fix is the
per-course editor → `tm_course_holes` overrides (authoritative, migration 043 +
GET/PUT `/api/courses/:id/holes` already live on the server).
- **A draft already exists UNCOMMITTED on Matt's Mac working tree** (`client/src/pages/HoleMapGL.jsx`,
  ~41 lines): editMode/editDraft/editCandidates/onMapTap props + guarded edit
  layers (editCand/editLine/editPts sources) + a tap handler. Guarded by
  editModeRef — zero risk to normal mode. DO NOT lose it; build on it.
- Still needed (the page side, in EagleEye): an entry point (course-name area /
  a "Map this course" affordance when geometry is missing or wrong) → per-hole
  step-through (tap tee → tap green → next hole) with snapping to OSM candidate
  dots (`teegreen` data already fetched) → PUT overrides → reload
  `holeOverrides` → map is exact.
- Method: same as Phases 0–2 — Plan agent on the seams first, spec + checklist to
  wiki, slices, gate, audit.
- **If a display trust-gate is still wanted after the editor: RENDER-side only.**
  The reverted attempt (`ad6eb83`, reverted `4831b2b`) filtered the shared
  holePositions/greenPositions data maps — the OSM gap-fill logic read them too,
  saw gated holes as forever-missing, and refetch-looped (app slowdown + no
  holes). Lesson in log PM9.

## Shipped this session (all on `main`, chronological)
- **Phase 0** `c194432`: bar = Home · Match · ▶Play · Profile · Tour (Leagues → Match-tab
  segmented toggle w/ tab-press reset; Profile own tab via new `pages/Profile.jsx` +
  exported ProfileView; labels; stale-tab remap).
- **Phase 1** `f15bcb8`+`9014c8b`: ONE CoursePicker (sheet|inline verbatim variants,
  shared search layer); solo seeds sharedCourse + gender-correct tees;
  `lib/eye-hole.js`; `lib/course-recents.js`; PlayStart funnel (confirm card, 9|18,
  Solo|Match, light match create + invite chip, `pendingOpenCode` open-not-join).
- **Device-pass fixes** `d8ff9b5`→`0431fd5`: PlayStart reachable over an active course
  view (course-name tap + Back-to-map); map HUD hidden on the start screen; copy →
  "AI-POWERED CADDIE" + framing rule (NO "rangefinder mode" copy — EE is ONE surface,
  yardages+scoring together); session model = map only when a round is ACTIVE
  (isActive re-arm + back-prompt end sheet routing to the real end flows);
  **instant NEARBY COURSES** in both pickers (OSM `nearby` Overpass type, 0.1° grid
  cells in tm_osm_cache; tap → name-resolve to GolfCourseAPI, never dead-ends);
  invite chip into the header stack (no HUD overlap).
- **Phase 2** `1dcd5b8`+`fc14f8a`+`e0c0af0`: `lib/active-round-session.js` (doctrine:
  solo truth = blob, match truth = server, session = INDEX, never load-bearing;
  merge-upsert, code-guarded clears, reconciliation via LiveOuting polls + throttled
  /recent on Play entry) — hub blind spot CLOSED; owner-mounting on boot;
  `QuickScoreSheet` (owner-rendered portal → real saveScore w/ queue/idempotency/OCC/
  rides/celebrations, zero forked scoring; EE SCORE pill; hole follows EE one-way);
  consent-based GPS advance nudge (45yd/3-tick/per-hole dismiss, never auto).
- **Save=advance** `04bb504`: sheet save closes + advances map to next hole (failed
  OCC saves keep it open; solo advances its scorecard hole in step).
- **TDZ crash + gate hardening** `8d6b205`: 'vt' crash fixed (P2-F dep array read
  showStart declared later); **`no-use-before-define` (variables) added as the 3rd
  lint error rule** — it immediately caught a 2nd shipped crash (inline picker's
  `useNearbyCourses(coords)` above `coords`). Every gate rule now has a crash story.
- **Trust gate reverted** `ad6eb83` → `4831b2b` (see NEXT BUILD above).

## Carry-forward invariants (additions this session in bold)
- rivalries ONLY from completed scorecards; `/end` idempotent; `save:false` records
  nothing; lie `recovery`; toPin = raw gpsToGreen; currentHole 1-idx vs solo/
  saveScore/shot-buffer 0-idx (convert ONCE at the owner boundary).
- **Session doctrine: solo truth = blob, match truth = server, session = index —
  readers self-heal by clearing; never load-bearing.**
- **EE framing: AI-powered CADDIE, one surface; never "rangefinder-only/no-scoring"
  copy.**
- **QuickScoreSheet: owner-rendered portal; EE only toggles; hole flow one-way.**
- **Scorecard = truth anchor for yardage; but any geometry gate must be RENDER-side.**
- **Dep arrays + hook arguments are render-time code — declaration order matters
  (no-use-before-define now enforces).**
- Beta discipline: build+lint (incl. new rule) straight to `main`; git via
  desktop-commander (sandbox can't reach GitHub).

## Open / blockers
1. **NotebookLM main bucket FULL (50/50)** — [[synthesis/play-oncourse-phase2-build-spec-2026-07-10]]
   FAILED to sync (upload_failed: 1). Consolidate sources (handoffs-rollup pattern /
   IGNORED list / merge superseded specs) BEFORE the next wiki page is created.
2. **HoleMapGL editor draft uncommitted** on Matt's Mac — the next build's foundation.
3. **Phase 2 runtime verification** — none done: spec §7 device matrix (session
   start/end matrix, sheet e2e w/ 2nd device + offline replay + OCC chip, nudge on a
   real walk, reload-mid-match). Phase 1 residuals: wizard/league regression pass,
   picker pixel check, nearby resolve accuracy in the field.
4. Matt's on-course EE walk-and-confirm GPS pass + Slice 4 auto-lie (from 07-08) still
   pending; POST-LAUNCH #25 (native-shell round) unchanged.
5. Deferred product follow-ups: in-sheet full scorecard grid (match), bottom-strip
   scorecard placement, `/nearby` server endpoint if OSM-nearby proves thin, GPS-only
   mode (Phase 3), post-round flyover editor (Phase 3).
