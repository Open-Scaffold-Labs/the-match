---
type: synthesis
created: 2026-07-10
updated: 2026-07-10
tags: [eagle-eye, play-tab, active-round-session, scorecard-sheet, auto-advance, phase-2]
---

# Play on-course — Phase 2 build spec + progress checklist (2026-07-10)

Parent: [[synthesis/start-match-unified-flow-plan-2026-07-09]] (Phase 2). Phase 0+1
SHIPPED through `bbf24d6` (+ device-pass polish `8c6e3d2`/`0431fd5`; session-model
corrections `f941261`/`d8ff9b5`; see [[synthesis/play-funnel-phase1-build-spec-2026-07-10]]).
Grounded in two fresh agents this session: on-course scoring/auto-advance micro-UX
research (cited: 18B/Golfshot/Hole19/SwingU/TheGrint/Arccos/Garmin/GolfLogix + review
complaints) and a Plan agent seam map verified at HEAD `732639b`.

## 1. Research distilled — the bar to beat

- Scorecard entry over the GPS is table stakes (TheGrint's "never exit the GPS
  screen" is the flagship framing); the best pattern is a PERSISTENT bottom strip
  (Hole19/SwingU), not a hidden gesture; tap the hole label = jump-to-hole picker.
- Score-driven advance (18B/TheGrint/SwingU: save → next hole, zero taps) is loved;
  GPS-driven advance is the complaint magnet: Garmin fires while you're still
  approaching (and ships NO off switch — their support says factory-reset), Arccos
  dead-ends on chip-ins and locks onto the wrong hole when tees sit <40m from
  greens, Hole19's watch bounces holes randomly. GolfLogix documents the crudest
  trigger (75yds from green → 2-minute timer).
- **Unclaimed territory (verified): nobody ships a toast+undo for hole advance.**
  Every wrong-hole complaint above becomes reversible with one.
- Lost-score state is the trust killer (SwingU reviewers keep paper backups;
  Hole19 loses rounds at hole 1). We already have the F.5 offline queue +
  idempotency — per-tap persistence, no Save button for self-score.

## 2. Architecture (Plan agent; full seam map with file:line in the agent output,
summarized here)

- **S1 `lib/active-round-session.js`** — `tm-active-session-v1-${uid}`:
  `{ kind:'solo'|'match', code?, courseId?, courseName?, courseTee?, holeCount?,
  startedAt }` + `tm-session-changed` event. **Doctrine (file header): solo truth =
  the solo blob; match truth = server status; the session is an INDEX for the Play
  surface, never load-bearing.** Merge-upsert (sparse writers never erase richer
  fields — course-recents pattern); `clearSession(uid, {code})` is code-guarded so
  an old match's late clear can't kill a new session. Writers W1–W9: EE startRound
  solo+match, SetupSheet start, solo restore-on-mount self-heal, CreateWizard
  onCreated, JoinSheet, QR join, LiveOuting first-load enrich (also covers
  hub-resume), pendingOpenCode. Clears C1–C5: doEnd, guard discard, commissioner
  cancel, solo save (via clearSavedRound), hub solo discard. C6 (remote end/cancel)
  = reconciliation: LiveOuting loadOuting clears when status≠active; Play-tab entry
  verifies a match session against `GET /api/outings/recent` (throttled) and a solo
  session against the blob.
- **S2** — EE's four predicates (showStart init, tab-entry re-arm, back-button
  branch, activeCapture scope) + PlayStart resume card read the session. Match
  resume = existing `onMatchStarted` plumbing (renamed `onOpenMatch`): mounts
  Outing hidden → live view → activeScoring publishes → map.
- **S3 QuickScoreSheet — option (c), OWNER-RENDERED PORTAL (zero fork).** Key code
  facts: portals escape TabPanel display:none (endPrompt/conflict chip/celebration
  already render over any tab), and `saveScore` is inseparable from LiveOuting's
  state (participants compare, endpoint routing, OCC handshake). So the sheet is
  rendered BY LiveOuting (match) / ActiveRound (solo), portaled to body (~z-8900,
  below all modals), toggled by EE via App `quickSheet` state (forced closed when
  tab≠EYE). Collapsed: hole + par + stepper + PuttChips + shot count + Save →
  `saveScore(hole-1, …)` with the exact ScoreModal ride guards. Expanded: the
  owner's existing ScorecardTable. Celebrations/conflict chip inherited free.
  Self-score only in v1. Prereq **P2-C**: owner-mounting guarantee (solo start
  from Play must mount Outing hidden too; App boot effect re-mounts from session).
- **S4 auto-advance NUDGE (never silent, never auto)** — trusted fix (≤10m acc) +
  within ~45yd of NEXT hole's tee + closer to next tee than current green + 3
  consecutive GPS ticks → chip under the hole selector: "On hole N? Move to hole N
  ✕". Accept = changeHole semantics. Dismiss persisted per course+hole
  (`tm-eye-nudge-dismissed`), cleared at round start. Research toast+undo variant
  lands with it: after accept, brief "Back to N−1" affordance. No chip ever on the
  last hole; no end-of-round behavior.

## 3. Decisions taken (Plan-agent recommendations; Matt can override)

1. Created-but-never-entered match (wizard → CodeShare → back out) DOES surface on
   the Play resume card as "MATCH ABCD — open" (it holds the one-active guard, so
   hiding it would be confusing).
2. Sheet v1 = self-score only; host/marker/bulk entry stays on the Match tab.
3. Solo expanded sheet v1 = "Full scorecard →" jump to the Match tab (no rebuilt
   grid in the sheet).
4. Nudge radius 45 yds (flag: Matt may want ~35 for short tee walks).

## 4. Slices + progress checklist (gate per slice: client build + lint; no server changes anywhere in Phase 2)

- [x] **P2-A** Session lib + writers W1–W9 + clears C1–C5 + both reconciliation
      readers — BUILT 2026-07-10 (`1dcd5b8`). Verified: build+lint+tests; all
      writer/clear sites wired per seam map (C3 commissioner-cancel covered by
      LiveOuting status reconciliation — no uid in that component's scope).
      NOT verified: the devtools start/end matrix (browser) — device checklist.
- [x] **P2-B** Play reads the session (predicates + capture scope + resume card
      + onResumeMatch via existing onMatchStarted) — BUILT 2026-07-10
      (`1dcd5b8`). Verified: build+lint. NOT verified: live hub-blind-spot
      walkthrough + stale-session self-heal on device.
- [x] **P2-C** Owner-mounting guarantee (App boot re-mounts from session;
      tm-solo-started mounts Match tab) — BUILT 2026-07-10 (`1dcd5b8`).
      Verified: build+lint. NOT verified: reload-mid-match walkthrough.
- [x] **P2-D** QuickScoreSheet (match) — BUILT 2026-07-10 (`fc14f8a`).
      Owner-rendered portal (LiveOuting) → real saveScore (queue/idempotency/
      OCC/rides/celebrations inherited); EE SCORE pill; sheet follows EE hole
      one-way; hole bounds guarded. Verified: build+lint. NOT verified: ALL
      runtime behavior (sheet score → server, offline replay, conflict chip,
      celebrations over the map) — browser/device.
- [x] **P2-E** QuickScoreSheet (solo) — BUILT 2026-07-10 (`fc14f8a`).
      ActiveRound renders it; Save = setScore+setPuttFacts (autosave blob);
      1-idx→0-idx at the boundary. Verified: build+lint. NOT verified: runtime.
- [x] **P2-F** GPS advance nudge — BUILT 2026-07-10 (`e0c0af0`). Trusted-fix +
      45yd + closer-than-current-green + 3-tick chip; per-course+hole dismissal
      (cleared on course pick); never last hole, never automatic. Deviation
      from research rec #6: no undo TOAST — ours is consent-based (chip), so
      undo = the hole arrows; toast+undo becomes relevant only if auto-advance
      ever ships. Verified: build+lint. NOT verified: any GPS behavior (needs
      a real walk — Matt).
- [~] **Audit** (audit-before-claim) — run 2026-07-10; honest split above.
      v1 scope deviations from the Plan-agent architecture, logged: expanded
      sheet = "Full scorecard →" jump for BOTH match and solo (the in-sheet
      ScorecardTable is a follow-up); no save→advance (hole movement = nudge +
      arrows). REMAINING: the whole §7 device matrix.

## 7. Device checklist for Matt (all NOT-yet-verified)

1. Session: start/end rounds every way (Play solo, Play match, SetupSheet,
   wizard, join, QR, guard discard, hub solo discard, commissioner cancel from
   a 2nd account) — Play should always know: map when live, start screen when
   not, resume cards correct. The old hub blind spot: open a match, back out
   to the hub, go to Play → should show the MAP now.
2. QuickScoreSheet match: SCORE HOLE N pill → sheet; save → Match tab
   scorecard + a 2nd device sees it; airplane mode save → replays once;
   conflicting write from the marker → conflict chip pops over the map;
   birdie → celebration over the map; putts persist; re-save wipes nothing.
3. QuickScoreSheet solo: sheet scores land in the solo round; Finish shows
   them; hole numbers line up (sheet hole 1 = card hole 1).
4. Nudge (on-course): chip near the next tee only with a good fix; dismiss
   sticks for that hole; accept moves the map; nothing on 18.
5. Reload mid-match on the Play tab → scoring still armed (owner remounts).

## 5. Risk register (full table in Plan-agent output)

Top lines: session races → merge-upsert + code-guarded clears + never load-bearing
(readers self-heal by clearing); two entry surfaces racing → App closes sheet when
tab≠EYE + same saveScore + idempotency keys; portal z-index → sheet 8900 < modals
9999 < EE leave prompt 10000; auto-advance false positives → accuracy gate + 45yd +
closer-than-current-green + 3-tick debounce + per-hole dismiss, chip-only. Hole
indexing: EE/session/UI 1-indexed; saveScore/solo-blob/shot-buffer 0-indexed —
convert ONCE at the owner boundary. Invariants: h2h only via /end save:true;
save:false records nothing; session layer never triggers result writes.

## 6. Session log

- 2026-07-10: spec written from 2 fresh agents; build starting with P2-A.
