# Next-Session Handoff — 2026-07-09 (ACTIVE; supersedes 2026-07-08)

Mandatory start: **roll-call → wiki/index.md → this file + `wiki/log.md`'s latest entries**, then the new plan [[synthesis/start-match-unified-flow-plan-2026-07-09]] (the next build's north star).

> Honest note: this session did NOT begin with roll-call/preflight (Matt handed a
> run of direct UI/UX + data tasks). Next session: run roll-call first per CLAUDE.md.

## TL;DR
A polish + correctness + data-cleanup + research session. Shipped: Eagle Eye HUD
re-layout (single bottom control row), the LiveOuting header rebuilt into ONE
**MatchMenu** dropdown (no more scattered emoji pills), grass background on the
Match/Scorecard surface, and a real **match-end correctness fix**. Cleaned a pile of
seed/test pollution out of Matt's prod account (handicap, rivalries). Produced a
researched **"Start Match / unified on-course" plan** — the agreed next build starts
at **Phase 0 (nav restructure)**. Nothing blocked.

## Commits on `main` this session (chronological, all build+lint verified)
- Eagle Eye HUD: `5724a51` LOG SHOT → smaller pill · `225a1f9` single bottom row (DIAL|BIG toggle + centered distance card + LOG SHOT) · `dac1165` shrink toggle (no overlap) · `66b1a13` nudge hole selector down · `04fb5a6` LOG SHOT dark-glass · `71b0482` LOG SHOT full-pill shape.
- LiveOuting header: `2919d60` header chips redesigned (no emoji, line-icon set) → `c04d243` **all controls consolidated into one MatchMenu dropdown** → `1ea7ca9` MENU left / GET DISTANCES right on one row. (Interim GET-DISTANCES placements `ae0e8cc`/`0949f08` were REVERTED by `67eb44b`/`f959998`; final placement `9d131fb` then folded into the row.)
- Background: `125b37a` Match/Scorecard tab shares the Home grass photo (App.jsx grassTab + TabPanel opaque=false) · `51d45d1` OutingHub transparent root so grass shows on the Matches page.
- **Correctness — active-match guard** `2fd3934`: the "you're already in a match" guard now DISCARDS the old match via `POST /:code/cancel` (lightweight) instead of the heavy `/end` ceremony, and REFUSES to proceed if the discard fails — so a second live match can never be created. Copy → "Discard it & continue".
- **Correctness — match end** `f94e6ff` (server + client):
  - Server `/end` is now **idempotent** (only the active→closed call writes stats; re-ending returns the summary but tallies nothing — fixes the "ended 4× = rivalry counted 4×" inflation).
  - Rivalries (`tm_match_history`) are built from **COMPLETED scorecards only** (`buildPairRows(completedDb)`), so an unfinished round can't move head-to-head.
  - `/end` accepts `{ save }`: `save:false` closes the match WITHOUT recording rounds/rivalries/handicaps.
  - Client `endMatch()` checks `isRoundFullyScored()`. Finished round → ends normally. **Unfinished → a bottom sheet: Save & record stats / End without saving / Keep playing** → drives the server `save` flag.

## Prod DB cleanup done this session (Matt's account, user_id 1 — direct SQL via Supabase MCP, project `bqjdiixkygslaryxcyfg`)
All reversible-minded (cancel/soft where possible; deletes only for clearly-labeled seed data):
- **Two live matches → one.** Walkthrough throwaway outing **87** ("S4 WALKTHROUGH THROWAWAY", host=2, Matt only joined) set `status='cancelled'`. Real match 8EG6 kept.
- **Handicap 8.5 → 14.2.** Deleted **13 bulk-seeded championship-course rounds** (identical insert ts `2026-05-01 17:00:30.306438`; Bayonne/Bethpage/TPC/Torrey/Augusta/Pebble — their 86-91 on 142-152 slope made the index artificially single-digit). Recomputed with the app's OWN `handicap.js` engine over the 6 real rounds → **14.2** (lowest-2 of 6 differentials −1.0); wrote `tm_users.handicap` + a `tm_handicap_history` row.
- **Rivalries purged of seed + incomplete matches.** Deleted the 13 "Seed: Matt vs X" match_history rows + 5 purely-seed h2h records (Taylor Briggs/Sam Rivera/Chris Murphy/Ryan Torres/Dale Johnson), then the 13 "Seed:" outings (ids 32-44) themselves (cascade cleaned participants/messages/side-bets/match-history). Then removed match_history for the **incomplete/0-round outings 68 + 76** (76 = the East-Orange match Matt stopped tracking, ended 4× → Tiger 0-4 inflation) and **rebuilt Matt's h2h from completed matches only** → **Daniel Christie 1-1, James Ashe 1-0** (Tiger/Mary/Pat/Sean removed — they existed only via unfinished matches). Note: Tiger Woods (user 55) is a REAL friend's profile — kept where real.
- Left as-is per Matt: closed outings 68 + 76 still exist as no-result matches in history.

## THE NEXT BUILD — unified "Start Match / on-course" (plan is the deliverable)
Full researched plan: [[synthesis/start-match-unified-flow-plan-2026-07-09]] (competitor funnel + on-course UX research via 3 agents, current-code seam map, phased build). Agreed direction:
- **Target nav:** Home · **Match** · **▶ Play** · **Profile** · **Tour**. "Play" (center, today's Eagle Eye slot) becomes the start funnel + on-course surface; keep "Eagle Eye" as the in-screen brand. NOT "Start Match" (would mislabel a rangefinder).
- **Phase 0 (do first — small, low risk):** merge Leagues into a **Match** tab with a `Matches | Leagues` top segmented toggle; **promote Profile** from `homeView` sub-view to its own tab; **rename the EYE tab label Eagle Eye → Play**. Pure IA/label, no round-logic risk. Matt greenlit starting here.
- Phase 1: Play as the funnel (unify the TWO `CoursePicker`s; GPS-default course confirm-not-search; Solo/Match branch; **wire solo into `sharedCourse`** — a real seam today). Phase 2: single active-round session model + scorecard as a swipe/sheet peer of the map + forgiving auto-advance. Phase 3: post-round flyover shot editor (phone-first SG edge), GPS-only mode.

Key code seams (from the map, all under `client/src`): nav in `App.jsx`/`components/shell/BottomNav.jsx`/`constants.js` (OUTING tab is mislabeled "Scorecard"); two divergent `CoursePicker`s (EagleEye.jsx line 432 dark vs CreateWizard.jsx line 60 light, reused by solo `ActiveRound.jsx`); Profile is `Home` sub-view via `homeView`; `sharedCourse`/`eyeHoleNudge` thread course + hole between tabs; solo `SetupSheet` omits `onCourseTeeSelected` (doesn't seed the map).

## Carry-forward invariants (still true)
- Match-end: rivalries ONLY from completed scorecards; `/end` idempotent; `save:false` records nothing. Don't regress by writing h2h from raw participant totals again.
- lie key `recovery` (never `trouble`); toPin = raw gpsToGreen; currentHole 1-idx vs 0-idx; SG gate shots+putts===score; solo one-blob + `tm-solo-shots` sync (from EE walk-and-confirm work).
- Beta discipline: build-verified code goes straight to `main` (it IS the test env); gate = `npm --prefix client run build` + `lint` + `node --check` changed server files. Sandbox can't reach GitHub → git via desktop-commander.

## Open / deferred
- Matt's on-course GPS pass for EE walk-and-confirm (real GPS) + Slice 4 auto-lie polygons — still pending from 2026-07-08.
- Durable fix so seed/walkthrough data never pollutes real accounts again (an `is_seed`/`is_demo` flag or a dedicated test user) — offered, not yet built.
- Match-end save-prompt: verify on-device (built + build/lint green; not yet exercised in a live incomplete outing).
