---
type: synthesis
created: 2026-07-09
updated: 2026-07-09
tags: [eagle-eye, outings, navigation, ux, on-course, start-round]
---

# Unified "Start Match → on-course" flow — plan (2026-07-09)

Goal (Matt): Eagle Eye is what people use *on the course*, so it should double as the
**Play / Start Match** surface — tap Play → course selector → match-starter wizard →
you're on the course with GPS + scorecard live. Merge Scorecard + Leagues, promote
Profile to its own tab. Be as good or better than the top golf apps on friendliness,
visual flow, and functionality.

This plan is grounded in (a) research on the top consumer golf apps' start-round funnel
and on-course UX, and (b) a full map of the-match's current Eagle Eye / match-create /
scorecard code.

---

## 1. What the best apps actually do (research distilled)

**Start-round funnel — the convergent pattern across 18Birdies, Golfshot, Hole19, SwingU,
TheGrint, Arccos, Garmin, GolfLogix:**

> **Play/Start → (GPS-detected course, confirm or change) → tee → players/format → Start →
> land directly on the live GPS + scorecard for hole 1.**

- **GPS auto-detects the course as a pre-filled default** — you *confirm*, you don't search.
  This is the single biggest friction remover. (18Birdies, SwingU, TheGrint, Arccos, Garmin.)
- **Single-course facilities auto-populate settings** → near-zero setup (SwingU).
- **A "GPS-only" mode** for players who just want yardages and skip scoring/handicap setup
  (Hole19 toggle, 18Birdies input-mode choice).
- **Remembered defaults** (last course, last tees, solo-by-default). Fastest apps reach
  hole-1 distance in ~2–3 taps; setup-heavy ones take ~4–6.
- **Naming:** the start action is overwhelmingly **"Play"** (central tab, 18Birdies/SwingU/
  TheGrint) or **"Start Round"** (Golfshot/Arccos/Garmin). The on-course/GPS surface is not a
  separate "GPS" tab — you enter a *round*, and the map is the round.

**On-course experience — the winning model:**

- **GPS map is the home screen of the round.** Satellite hole view, big legible
  distance-to-center, secondary front/back, a **draggable target cursor** that live-updates
  carry + remaining. (The Match already has this — `DistanceInstrument`, `HoleMapGL`, FCB,
  plays-like, aim point.)
- **Contextual numbers, not manual toggles:** tee→target when far, auto-collapse to F/C/B
  inside ~200 yds (18Birdies). The Match's `bigMode` + range logic is close already.
- **Scorecard is a bottom sheet / swipeable peer *over* the GPS** — never leave the round to
  score. Simple "tap your total" by default, Detailed (putts/FIR/GIR/penalties) as
  progressive disclosure.
- **GPS ⇄ Scorecard ⇄ Leaderboard are peers of one round context**, reached by swipe/sheet —
  not full-screen tab jumps.
- **Forgiving GPS auto-advance** (proximity/timer), obvious manual override, "verify last
  hole" nudge — and it must **never end the round on its own** (TheGrint's #1 complaint).
- **Defer shot-attribution detail to a post-round flyover editor** — on-course capture stays
  one-tap/optional; the tedious club/lie tagging happens on a satellite replay after.

**Premium vs. cheap dividing line:** premium apps make *the needed number the hero on a calm
screen* and let everything else recede — ad-free on-course surface, direct-manipulation map,
legible plays-like. Cheap ones bury the number under ads, feeds, and upsells. (This matches
the-match's App-Store-grade standard and our recent header cleanup.)

**Phone-first edge (no proprietary sensors):** we can't match Arccos/Garmin auto-capture, so
we win on (1) the cleanest, ad-free, contextual GPS screen; (2) a genuinely legible plays-like;
(3) a delightful **post-round flyover shot editor** → real strokes-gained without hardware; and
(4) rock-solid, forgiving navigation + never-lose-your-round scoring — exactly the reliability
gaps where incumbents draw their loudest complaints.

---

## 2. Where the-match is today (code map — the seams)

- **Nav (`App.jsx`, `BottomNav.jsx`, `constants.js`):** Home · **Scorecard**(`OUTING`) ·
  **Eagle Eye**(`EYE`, center) · Leagues · Tour. The `OUTING` tab is mislabeled "Scorecard"
  and actually hosts the whole matches hub (`Outing.jsx` → hub/live/solo/create). Profile is a
  Home *sub-view* (`homeView==='profile'`), not a tab. Tabs stay mounted (`mountedTabs` +
  `TabPanel`), so popping into Eagle Eye mid-round and back is already seamless.
- **Eagle Eye (`EagleEye.jsx`, `HoleMapGL.jsx`):** full standalone rangefinder AND
  during-match surface. Gets its course from its own `CoursePicker` or from App's
  `sharedCourse`. Links to the scorecard via a **SCORECARD pill**; the scorecard links back via
  **GET DISTANCES** → `onGoToEagleEye(hole)` (sets `eyeHoleNudge`, switches tab). Shot capture
  runs when `activeScoring={kind:'outing',code}` (solo special-cased).
- **Match create (`Outing/OutingHub.jsx`, `Outing/CreateWizard.jsx`):** hub with Create / Enter
  Code / Solo; `CreateWizard` is a heavy 3-step sheet (name+course+holes+count → formats →
  team structure), built for events up to 150 players + leagues.
- **Live scorecard (`Outing/LiveOuting.jsx`):** reached at `view==='live'`; on first load, if the
  match has a `course_id`, it seeds Eagle Eye via `onCourseSelected` (once per outing).
- **Solo (`ActiveRound.jsx`):** separate `'setup'|'scoring'|'summary'` flow; setup sheet titled
  **"Start Round"** already.

**Seams to fix for unification:**
1. **Two `CoursePicker`s** (EagleEye dark vs. CreateWizard light, reused by solo) — same
   backend, divergent theme/shape. → one themed component.
2. **Solo setup never seeds `sharedCourse`** (`SetupSheet` omits `onCourseTeeSelected`) → Eagle
   Eye doesn't auto-load the solo course. Smallest highest-value fix.
3. **Three separate "start" entries** (Eagle Eye "Select Course", CreateWizard, solo SetupSheet).
4. **Two hole trackers** (Eagle Eye `currentHole` per-course LS vs. LiveOuting `myNextHole`),
   bridged only by the one-shot `eyeHoleNudge`.
5. **State scattered** across App props + localStorage (`tm-shared-course`, `tm-eye-hole`,
   `tm-last-tab`, solo blob) — no single "active round" session object.

---

## 3. Recommended target — navigation + model

**New bottom bar (5, center-weighted):**

> **Home · Match · ▶ Play · Profile · Tour**  — "Play" is the raised center action (today's
> Eagle Eye slot). Keep **"Eagle Eye"** as the *branded name of the rangefinder inside* the
> Play screen; the tab label is the functional "Play."

- **Play (center)** = the start funnel + the on-course surface. This is Matt's idea, aligned to
  the universal "Play" convention.
- **Match** = the record/hub: active + recent matches, resume, history, rivalries — with a
  **`Matches | Leagues` segmented toggle** at the top (merges the two old tabs without demoting
  Leagues to a hidden button). This is "review/manage," not the primary start.
- **Profile** = promoted from Home sub-view to its own tab.
- Home and Tour unchanged.

**One "active round" session model** (new): `{ kind:'solo'|'match', code?, course, tee, holeCount,
currentHole, scoringOn }`. Replaces the scattered `sharedCourse` + `eyeHoleNudge` + solo-blob
patchwork. Play, Match, and the scorecard all read/write this one object. Generalize
`activeScoring` to include `{kind:'solo'}`.

---

## 4. The unified Play funnel (target UX)

Tapping **Play**:

- **If a round is already active → resume it instantly** (straight to the map; a small "resume"
  confirmation only if stale). One-tap resume is a top friction-remover.
- **If not →** the Play start screen:
  1. **Course** — GPS-detected nearest course pre-selected as a confirm chip ("Silver Lake ·
     change"). Search only if wrong. Recents/favorites below.
  2. **Tee** — remembered default, one tap to change (gender-correct via `dedupeTees`).
  3. **Mode** — **Solo** or **Match** (segmented). Solo = go now. Match = a *light* inline
     setup: add players (or share link) + pick format, with the heavy `CreateWizard` still
     available from the Match tab for big events/leagues.
  4. **GPS-only toggle** for "just give me yardages."
  5. **Start** → land on the on-course map with scorecard armed.

Target: **2–3 taps to hole-1 distance** when the GPS course guess is right (matches SwingU/
TheGrint/Arccos), while preserving the full event wizard for organizers.

**On the course (Play screen):**
- Eagle Eye map is the hero (as today).
- **Scorecard as a bottom sheet / swipe-up peer** — not a tab jump. Simple total by default,
  Detailed opt-in. Leaderboard is a second peer for matches.
- **Forgiving GPS auto-advance** with manual override; never auto-ends. (Ties into the
  save-or-discard end flow we just shipped.)
- Post-round: **flyover shot editor** for effortless stats + strokes-gained (phase 3).

---

## 5. Phased build (each phase ships independently, build+lint+push)

**Phase 0 — Nav restructure (small, high-impact, ship first).**
- Merge `LEAGUES` into a **Match** tab with a `Matches | Leagues` top toggle.
- Promote **Profile** to its own tab (lift out of `homeView`).
- Rename the `EYE` tab label **Eagle Eye → Play** (keep Eagle Eye branding in-screen).
- Result: Home · Match · Play · Profile · Tour. Pure IA/label change; no round-logic risk.

**Phase 1 — Play as the start funnel.**
- Unify the two `CoursePicker`s into one themeable component.
- Build the Play start screen: GPS-default course confirm → tee → Solo/Match → Start.
- Wire **solo course selection into `sharedCourse`** (fix seam #2) so Eagle Eye always knows the
  course. Keep the full `CreateWizard` reachable from Match for events.

**Phase 2 — Unify on-course GPS + scorecard.**
- Introduce the single **active-round session** object; retire the scattered LS/nudge patchwork.
- Bring the scorecard into the Play screen as a bottom-sheet/swipe peer (GPS ⇄ Scorecard ⇄
  Leaderboard), removing the cross-tab jump for the common case.
- Forgiving GPS auto-advance (never destructive) + continuous hole sync.

**Phase 3 — Premium differentiators.**
- Post-round **flyover shot editor** → strokes-gained without hardware (phone-first edge).
- Polish plays-like legibility; GPS-only mode; keep the on-course surface ad-free and calm.

---

## 6. Honest risks / open questions

- **Play vs. Match overlap:** starting lives on Play; organizing/reviewing lives on Match. Keep
  the heavy event wizard on Match so Play stays fast. Watch for users hunting for "create" —
  a small "New match" affordance on both is fine.
- **Auto-advance reliability** is the classic trap (TheGrint). Ship it forgiving + override-first,
  or not at all.
- **Scope:** Phase 2's session-model refactor touches App, Eagle Eye, Outing, and solo — the
  biggest lift. Phases 0–1 deliver most of the perceived win at low risk; do them first and
  validate on-device before the Phase 2 refactor.
- **"Fall in line with competitors":** naming/labels above reflect current research (Play is the
  dominant start label); competitor UIs change, so revisit before finalizing copy.
