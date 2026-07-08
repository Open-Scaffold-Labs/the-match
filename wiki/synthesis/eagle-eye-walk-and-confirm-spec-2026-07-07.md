---
type: synthesis
created: 2026-07-07
updated: 2026-07-07
tags: [eagle-eye, strokes-gained, shot-capture, build-spec, handoff]
status: ACTIVE — ready to build (Slice 0 + Slice 1 first)
---

# Eagle Eye "Walk-and-Confirm" Shot Capture — Build Spec / Next-Session Handoff

## TL;DR for the next session

Build **real-time GPS shot capture inside Eagle Eye** ("walk-and-confirm") — the
research-confirmed best-in-class pattern and a differentiator no phone-only rival has
without hardware sensors. **The data pipeline (shot → `tm_rounds.shots` → Strokes
Gained OTT/APP/ARG) is ALREADY SHIPPED and end-to-end verified this session.** You are
building the *capture UX* in Eagle Eye that feeds it. Start with **Slice 0 + Slice 1
(outing path)** — reuse everything in "Shipped foundation" below; **no server change is
needed for Slice 1.**

Do the mandatory session-start steps first (roll-call, wiki/index, four-tool lookup),
then read this whole doc + the Plan section before writing a line.

---

## 1. The decision (Matt, 2026-07-07)

> "If the leaders abandoned [manual shot entry] so should we, and build this out right
> with the biggest name in golf apps move."

- **Abandon manual post-hole shot entry as the PRIMARY path.** A premium ShotSheet
  redesign (dark/stepper) was built this session then **reverted** — the plain
  `components/scorecard/ShotSheet.jsx` stays only as a minimal manual **fallback**.
- **Build real-time Eagle Eye "walk-and-confirm" as the primary capture.**

## 2. Why — research (agents, cited 2026-07-07)

- **Interaction:** the best apps (18Birdies, Hole19 Shot Tracker, Golfshot; Arccos/Shot
  Scope fully automatic with hardware) NEVER make you type or step a distance. At the
  ball you tap once; **distance is derived from GPS**, **club is auto-suggested** from
  that distance × your bag, **lie is auto-detected** from the mapped position — you
  **confirm, not build**. Draggable pins fix mistakes. Manual entry is an edit/override
  only. (18Birdies help, Hole19 help, Golfshot, Golf Pad, Arccos — see wiki/log PM.)
- **Visual:** for a *measurement* act like logging distance, go **dark "instrument"** —
  the-match already owns dark as its rangefinder language; WHOOP is the exemplar (near-
  black makes the data numeral pop). A darkened/blurred scrim over the light scorecard
  signals "you've entered the instrument." Gold as the single accent; distance as a big
  tabular hero. (Apple HIG dark-mode elevation; NN/g bottom-sheets; WHOOP teardown.)
- **The unfair advantage:** the-match already has Eagle Eye with live **GPS-to-pin** +
  tap-to-measure. That is exactly the "auto-fill distance" asset. No phone-only rival
  offers full four-category SG without sensors — this is the "biggest name in golf apps"
  move.

## 3. Shipped foundation — REUSE, do not rebuild (all done + verified this session)

- **Migration 042** `tm_outing_participants.shots jsonb` — APPLIED to prod (verified).
  `tm_rounds.shots` already existed.
- **`server/src/lib/shotFacts.js`** — `cleanHoleShots` (keeps `{lie,toPin,club?}`,
  drops junk, fail-soft) + `setShotsAtHole` (0-indexed hole; replaces the whole hole's
  array — client must send the FULL per-hole list, not a delta). 12 unit tests
  (`server/test/shot-facts.test.js`), incl. cleaned-shots → OTT/APP/ARG.
- **Server write path:** `PUT /api/outings/:code/scores` accepts an optional **self-only**
  `shots` key (touched only when the body carries it; mirrors putts; never wipes; never
  gates scoring). `outings.js` doSelfWrite ~1040-1057. Outing→round sync at
  `POST /:code/end` carries shots into `tm_rounds.shots` (outings.js ~2306/2323).
  **Solo** rounds save via `POST /api/rounds` (`shots` field, rounds.js).
- **SG engine** `server/src/lib/sg/index.js` walks COMPLETE per-hole chains
  (`shots.length + putts === score`, each shot valid off-green lie + `toPin>0`) into
  OTT/APP/ARG at read time. Incomplete/messy chains are silently skipped (safe, never
  corrupting). Round-level OTT/APP/ARG needs ≥9 complete shot-holes.
- **Client manual fallback (keep):** `ShotSheet.jsx` (plain), manual shot logs already
  render in `ActiveRound.jsx` (solo) and `Outing/LiveOuting.jsx` self-score modal.
- **E2E VERIFIED this session** (browser + in-page fetch + DB + engine): logging shots
  via `PUT /:code/scores` wrote `tm_outing_participants.shots`; `POST /:code/end` synced
  them to `tm_rounds.shots`; running the shipped `roundSG` on the synced 9-complete-chain
  round returned **sgOTT 2.34, sgAPP 17.1, shotHolesCounted 9** (magnitudes synthetic;
  point = categories populate). The three throwaway test outings were DB-cleaned.

## 4. Implementation plan (from a Plan-agent read of the code)

### 4a. Eagle Eye capture assets (`client/src/pages/EagleEye.jsx`)
| Field | Variable | ~Line | Notes |
|---|---|---|---|
| **toPin source** | `gpsToGreen` | 1297 | Trusted live GPS→green-center (yds); `null` when out of range. **Use THIS.** |
| DO NOT use | `displayYards` | 1355 | Follows the dragged **aim** point, not the pin — using it corrupts SG. |
| Pin fallback chain | `pinYards` | 1350 | `gpsToGreen ?? remaining ?? holeData.yardage` |
| GPS gates | `gpsUsable` 1295, `gpsOutOfRange` 1289, `gpsAcquiring` 1283 | | out-of-range gate already exists (800 yds) |
| Bag / club | `myBag` 828, `playerBag` 1422, `selectedClub` 830 | | from `/api/clubs/bag` |
| Current hole | `currentHole` (**1-indexed**) 809, `holeData` 1267, `totalHoles` 1271 | | |
| Green polygon | `greenPolys` 901, `greenPolygon` 1430 | | ONLY green polygons fetched (type=greengeom, 1093) |
| Club recommend | `ClubToggle.recommend()` | 2127-2144 | closest `avg_yards` to target — **reuse verbatim / extract to a helper** |

EE props today (~803): `{ user, onGoToScorecard, onExit, eyeHoleNudge, onConsumeEyeHoleNudge, sharedCourse, onCourseSelected }`. **No outing code / round identity.**

### 4b. Context wiring — THE key question
EE has **zero** knowledge of an active round/outing today; App.jsx holds no
`activeOuting`/`activeRound` state. Identity lives in:
- **Outing:** `pages/Outing.jsx` owns `activeCode` (39) → `<LiveOuting code=…>`. App gives
  Outing `onGoToEagleEye(hole)` (App.jsx ~427) — one-way handoff (hole number only).
- **Solo:** `pages/ActiveRound.jsx`, in-progress state mirrored to localStorage via the
  **shared** `lib/solo-round.js` `readSavedSoloRound(uid)`.

**Recommended wiring:** lift a minimal `activeScoring` descriptor to App.jsx and pass to EE:
`{ kind:'outing', code, holeCount } | { kind:'solo' } | null`.
- Solo: EE self-discovers via `readSavedSoloRound(user.id)` (no App wiring).
- Outing: publish `activeCode` up from Outing.jsx → App → EE (one callback, symmetric
  with `onCourseSelected`). EE derives its own hole from `currentHole`.

### 4c. Write path (critical constraint)
- The outing endpoint **requires `hole` + `score`**; shots can't be server-written
  mid-hole without a bogus score that would pollute the scorecard. **→ EE must NOT call
  the server directly.** EE appends to a **durable per-hole shot buffer**; the shots
  **flush through the existing score-modal save** (LiveOuting `saveScore`/`shotRide`,
  ~1221/1258 — already wired). Honest limit: app-kill mid-hole before scoring keeps
  shots only in localStorage (fine — SG only reads *complete* holes).
- Solo: append to `shots[holeIdx]` in the localStorage-backed round (ActiveRound `addShot`
  ~1011, `shots` ~932), bulk-saved to `POST /rounds` at finish.

### 4d. Club auto-suggest
Reuse `ClubToggle.recommend()` — suggest club for the **captured `toPin`** (not
`displayYards`). Extract the ~15-line closest-`avg_yards` match into a pure helper
(e.g. in `lib/clubModel.js`) so the toggle and the confirm sheet share it.

### 4e. Lie auto-detect — HONEST feasibility
- Only **green** polygons are fetched; there are **no fairway/bunker polygons** and
  **no point-in-polygon** helper in `geo.js` today.
- **v1 (ship this):** shot 1 → default `tee`; else default `fairway`; one-tap override
  chips (`tee/fairway/rough/sand/trouble` = the five `VALID_LIES`). Use the green polygon
  (add a ray-cast PIP) only to **warn** "you're on the green — that's a putt."
- Full auto lie (fairway vs rough vs sand) = later slice: new Overpass fetch
  (`golf=fairway`, `golf=bunker`) + PIP in `geo.js`. A centerline-distance heuristic is
  unreliable (doglegs/width) — do NOT use it.

### 4f. Capture UX slotting
HUD bottom stack renders ~EagleEye.jsx 1766-1909 (hero `order:2`, actions `order:1`,
DIAL|BIG toggle `order:3`); right rail ARCS/RINGS/ClubToggle ~2032-2079. Slot a dark-glass
**"LOG SHOT"** affordance into the HUD; confirm sheet = a new bottom-sheet styled after
`PlaysLikeSheet`/`BagSheet` (createPortal + glass): **distance hero** (snapshot `gpsToGreen`
at tap), auto-suggested club chip, lie chips (tee/fairway default), one-tap **Confirm**.
Gate the whole affordance on `courseCtx && activeScoring`; swap to a manual number field
when `!gpsUsable`. When `activeScoring` is absent, EE renders exactly as today.

## 5. Phased slices (each shippable + verifiable)

- **Slice 0 — shared per-hole shot buffer (no UI, no behavior change).** New
  `lib/shot-capture.js` (localStorage, keyed `outing:<code>|solo` + uid + holeIdx):
  `readHoleBuffer/appendShot/clearHoleBuffer`. Route LiveOuting `SoloScoreModal.holeShots`
  (~228) and ActiveRound `addShot` (~1011) through it → one source of truth. Verify: the
  existing manual "+ Log Shot" still flows to SG.
- **Slice 1 — outing walk-and-confirm (PRIMARY; RECOMMENDED FIRST).** Publish
  `activeCode` up to App → EE. Add the "LOG SHOT" HUD affordance + dark confirm sheet
  (gated `courseCtx && activeOutingCode`). On tap: snapshot `gpsToGreen` (manual field
  when `!gpsUsable`), auto-club via the extracted helper, lie = `tee` if buffer empty
  else `fairway` (+override), Confirm → `appendShot`. Shots flush via the existing score
  save. **No server change.** Verify: log 2 shots in EE on a par 4 → open the outing
  score modal (pre-filled) → save a 2-putt "4" → end match → `tm_rounds.shots` complete →
  SG shows OTT/APP.
- **Slice 2 — solo walk-and-confirm.** EE self-discovers via `readSavedSoloRound`. Handle
  ActiveRound re-hydration on tab focus (cross-tab desync risk).
- **Slice 3 — lie auto-detect v1.** Ray-cast PIP in `geo.js`; green polygon → block/warn
  "on green"; keep tee/fairway defaults + override.
- **Slice 4 (stretch) — fairway/bunker polygons.** New Overpass fetch + cache bump + PIP
  → true auto lie; degrade to Slice-3 when OSM has no data.

## 6. Risks (carry forward)
1. **Score-coupled write** — buffer + flush on the existing score save (don't send a bogus score).
2. **`toPin` must be `gpsToGreen`, not `displayYards`** (aim-follows) — load-bearing for SG correctness.
3. **Cross-tab desync** (EE tab vs score-modal tab, both mounted) — single source of truth = the buffer lib; re-hydrate ActiveRound on focus.
4. **Lie auto-detect is limited today** — v1 defaults + override; set expectations.
5. **Hole index off-by-one** — EE `currentHole` 1-indexed; arrays 0-indexed. Convert centrally.
6. **Chain completeness** — SG needs `shots.length + putts === score`; a miss silently drops the hole (safe). Consider a subtle "shots vs strokes" hint in the score modal.
7. **Don't break standalone EE** — gate ALL new behavior on `activeScoring`.

## 7. How to verify (the method that worked this session)
- `npm --prefix client run lint && ... run build && ... test` + `npm run test --workspace=server` (vitest) + `node --check` on touched server files.
- Browser walkthrough on the beta (`the-match-roan.vercel.app`) via Claude-in-Chrome; if a UI gesture is blocked, drive the API in-page: `fetch('/api/outings/<code>/scores', {method:'PUT', headers:{Authorization:'Bearer '+JSON-safe localStorage 'tm_token'}, body:{hole,score,shots:[…]}})`.
- Read-only DB checks via `psql "$DATABASE_URL"` from Matt's Mac (`.env`); to prove SG lights up, pull the synced round and run the real engine: `require('server/src/lib/sg').roundSG(round,'auto',handicap)` → expect non-null `sgOTT/sgAPP`.
- **Never push without asking Matt.** Additive/reversible + `activeScoring`-gated keeps it safe.

## 8. Session context (2026-07-07, how we got here)
This session (see wiki/log.md PM1–PM10): shipped EE C4 "Big Numbers" glance mode + its
F/C/B ordering fix, the Phase 4.3 token sweep (510 literals) + SVG attr→style, cut the
parked ANALYZE camera-rangefinder (assessed no-go: less accurate than GPS, App-Store 2.3
risk), then built + e2e-verified the outing shot-capture DATA pipeline (this doc's
foundation). Reconciled Dale's "Performance Intelligence / Strokes Gained" memo: the
SG engine (all four categories) is already shipped — the memo predates SG v2; the real
gap was DATA CAPTURE, which this walk-and-confirm build closes. The manual ShotSheet was
redesigned premium, then abandoned per Matt once research showed the leaders dropped
manual entry entirely.

**Next step:** build Slice 0 + Slice 1. Everything you need is above.
