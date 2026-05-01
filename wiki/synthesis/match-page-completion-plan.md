---
type: synthesis
created: 2026-05-01
updated: 2026-05-01
status: proposal
tags: [match-page, scoreboard, scorecard, plan, the-match]
---

# Match Page Completion Plan (2026-05-01)

> **Status: PROPOSAL — awaiting Matt's approval before any code changes.**

Three threads bundled into one plan, since they all live inside `client/src/pages/Outing.jsx`:

1. **New scoreboard view** — convert the live-match scorecard into a Tour-style scoreboard (toggle between the two on the live match page).
2. **Live match polish** — gaps in the active scoring flow.
3. **Match-end recap** — the "match is over" experience.

## What's already there (so I don't break it)

`LiveOuting` (line 1668 of `Outing.jsx`) holds all the live-match state. The scorecard is the existing Augusta-style table built from three components:

- `ScorecardTable` (line 2291) — front-9 / back-9 hole grid with score cells per player
- `TotalsRow` (line 2602) — TOTALS strip below the holes grid with avatar + surname + TOT/+/-/THRU
- `ScorecardCell` (line 1330) — individual score cell with par-relative tile color and birdie/eagle/bogey markers

Data shape I'll reuse for the new scoreboard view:

| Field | Source |
|---|---|
| Position ("1", "T2", "—") | `positions[i]` from `computePositions(sorted, getScores, holePars)` |
| Player photo | `participant.avatar` (data URL) — falls back to initials |
| Player name | `participant.name` (already used as "SURNAME" in caps for the scorecard) |
| TOT (score-to-par) | `diffStr(p)` returns "E" / "+5" / "-2" |
| TODAY | for a single-round match, same as TOT |
| THRU | `getScores(p).filter(s => s > 0).length` (or "F" if `=== holeCount`) |
| Match-play state | `matchPlayData` — only for 2-player matches with `'match'` in `scoring_formats` |
| Net vs gross | `netMode` toggle already exists; `netTotal()` and `netDiffStr()` already implemented |

Match-end summary (`EndMatchScreen` at line 705) already has `winner`, `podium[]`, `highlights`, `course`, `course_par`, `format`. Returns from `POST /api/outings/:code/end` and is passed via `onMatchEnd(summary)` callback.

## Thread 1 — Tour-style scoreboard view (new)

### Visual reference

The Tour page (`client/src/pages/PGAScores.jsx`) renders each player as a row in a translucent glass card:

```
[POS]  [PHOTO]  [PLAYER + country]  [TOT]  [TODAY]  [THRU]
 1      🏌️       Matt Lavin           -2      -2       F
                 USA
```

Wrapping card: `rgba(255,255,255,0.22)` + `backdrop-filter: blur(20px)` + `border: 1px solid rgba(255,255,255,0.45)` + `borderRadius: 16` + soft shadow.

Grid template: `gridTemplateColumns: '28px 44px 1fr 42px 42px 36px'`

Score colors (already a pure function in PGAScores.jsx, will lift to a shared module):
- under par → gold `#C9A040`
- even → green `#1B5E3B`
- over → red `#DC2626`

Leader row gets `rgba(201,160,64,0.20)` gold-tint background + 8px border-radius. Top-3 positions render in gold; everyone else in muted green. Position cell shrinks font when the position string is "T10"+ (longer than 3 chars).

PlayerPhoto component layers a faded country flag (opacity 0.18) under the headshot. For the match version, the equivalent is the user's `avatar` data URL (their generated PlayerCard, which already has the flag baked in) — so we just render the avatar full-bleed at 38px square, 10px border-radius. Falls back to initials on a deterministic background color (the same palette already used for `<PlayerAvatar />` initials in Outing.jsx).

### Toggle UX

A new control on the live match page header — segmented control with two icons + labels:

```
┌─────────────────────────┐
│ [▦ SCORECARD]│[≡ BOARD] │
└─────────────────────────┘
```

- Default: `SCORECARD` (the Augusta-style table — current default behavior).
- `BOARD`: the new Tour-style scoreboard view.
- Toggle persists per-match in component state (not in localStorage — fresh match opens to scorecard).
- Located in the host-controls row, alongside the `GROSS / NET` toggle.

### New component

`<MatchScoreboard />` — a sibling component to `ScorecardTable` inside `Outing.jsx`. Same module for now (consistent with anti-pattern #14 / U1: the Outing.jsx split is a separate session). Component takes:

```jsx
<MatchScoreboard
  participants={sorted}        // already-sorted participants
  positions={positions}        // already-computed leaderboard positions
  getScores={getScores}
  holePars={holePars}
  holeCount={holeCount}
  netMode={netMode}
  isMatchPlay={isMatchPlay}
  matchPlayData={matchPlayData}
  diffStr={diffStr}            // already in scope in LiveOuting
  netDiffStr={netDiffStr}
  user={user}                  // to highlight the current user's row
/>
```

### Visual mapping (Tour ↔ Match)

| Tour column | Match equivalent |
|---|---|
| POS | Same — already computed by `computePositions` |
| PHOTO + flag | User's `avatar` data URL (PlayerCard already has flag baked in) |
| PLAYER name | Player full name (Tour shows "Matt Lavin"); subline shows "Guest" if `is_guest`, "+5 hcp" if applicable |
| TOT (cumulative) | `diffStr(p)` — e.g., "+2", "E", "-1". For match-play: show the match-play state for the leader ("3UP"), opponent shows ("3DN"). |
| TODAY (round score) | Same as TOT for a single-round match. Hide the column entirely when not match-play, since it's redundant. |
| THRU | `getScores(p).filter(s => s > 0).length` — show "F" when complete |

For match-play matches (2-player + `'match'` format), TOT shows match-play state and TODAY shows score-to-par. For everything else, drop TODAY entirely and let TOT span wider (`gridTemplateColumns: '28px 44px 1fr 50px 36px'`).

### Score-to-par color helper

Extract `scoreColor(val)` from `PGAScores.jsx` line 6 into a new shared module `client/src/lib/scoreColors.js`:

```js
// Score-to-par color helper. Used by both the Tour page leaderboard
// and the live-match scoreboard view to keep the visual language identical.
export function scoreColor(val) {
  if (val == null) return 'rgba(13,31,18,0.40)'
  if (val < 0)  return '#C9A040'   // under par — gold
  if (val === 0) return '#1B5E3B'  // even — green
  return '#DC2626'                  // over par — red
}
```

Refactor `PGAScores.jsx` to import from the new module (one-line change). The match scoreboard imports the same.

### What does NOT change

- The Augusta scorecard view (`ScorecardTable` + `TotalsRow` + `ScorecardCell`) is preserved bit-for-bit. It's still the default.
- Score-entry tap-to-cell behavior is preserved on the scorecard view. The scoreboard view is read-only — tapping a row does nothing (or jumps to the scorecard view focused on that player; TBD in Thread 2).
- The polling loop, match-play computation, marker logic, host controls, etc. — all untouched.

### Risk

Low-medium. Pure-additive: a new component and a toggle. The old behavior is the default. Worst case: the toggle button doesn't render correctly, but the scorecard still works.

---

## Thread 2 — Live match polish

These are the gaps in the active scoring flow surfaced by reading through `LiveOuting`. Pulled from the audit's open items + observation:

### 2A. Tap a row in scoreboard view → jump to scorecard focused on that player

When the user is on the scoreboard view and taps a player row, switch back to scorecard view with that player's row scrolled into view (and pulse-highlighted briefly). Useful when 6+ players are in the match and finding one's row in the wide scorecard takes effort.

**Implementation**: scoreboard view's row `onClick` handler sets `viewMode = 'scorecard'` and sets `focusPlayerId = p.user_id`. Scorecard table reads `focusPlayerId`, applies `scrollIntoView({ behavior: 'smooth', block: 'center' })` on the matching row + a 1-second `tm-row-flash` keyframe animation.

### 2B. End-of-hole confirmation toast

Currently when a score lands, the recent-event banner pops down for 4s. That's good for broadcast feel. But the player who just entered the score doesn't get a clear "saved" confirmation if they're moving fast.

**Proposed**: dim the recent-event banner from gold (3-4s) down to nothing, and add a subtle 600ms toast confirmation ("✓ Saved") at the bottom of the score-entry modal when it closes. This gives the score-enterer a clear acknowledgment without competing with the broadcast banner.

**Risk**: Low. New component, no existing logic touched.

### 2C. "Active hole" advance on save

Currently `activeHole` is computed as `Math.max(0, ...participants.map(p => getScores(p).filter(s => s > 0).length))` — i.e., max-played + 1. This assumes everyone moves through holes together. In real play, especially with markers + groups, players move through holes at different paces.

**Proposed**: compute `activeHoleByPlayer` for the score-entry modal — when tapping an empty cell, default to the player's own next hole (their max-played + 1) rather than the global max. The scorecard tap-hint pulse stays as-is (the global "first empty cell anyone can edit").

**Risk**: Low. Per-player computation; falls back to global if no scores yet.

### 2D. Persistent NET toggle preference

Currently `netMode` resets to `false` every time `LiveOuting` mounts. Hosts who run net-handicap matches re-tap NET every time they open the match.

**Proposed**: persist `netMode` to localStorage keyed by `outing.code` (or `outing.id`) so it survives refresh + tab-switch. Cleared when the match ends.

**Risk**: Trivial. Standard localStorage pattern already used elsewhere in the app.

### 2E. Score-undo within the modal

Score modal currently has Save + Cancel. No undo for an existing score (you can re-tap the cell and enter a new value, but if you tap the cell by mistake there's no way to clear back to "—"). The schema supports null/0 for unscored holes.

**Proposed**: add a "Clear" button to the score modal (only when an existing score is set). Clears via the same PUT endpoint with `score: 0`. Confirms with a single toast.

**Risk**: Low. Server already handles `score = 0` as "not played"; just exposing it in the UI.

---

## Thread 3 — Match-end recap

The current `EndMatchScreen` is solid (trophy + podium + highlights + share). Three additions to make it feel more like a tournament wrap:

### 3A. Hole-by-hole story (F13 candidate, scoped down)

After the podium + highlights, render a 3-5 line "story of the match" generated client-side from the score data:

- **Stroke play**: "Lavin ran away with it after a back-9 -3 surge." or "Tied through 14, decided on the par-3 16th."
- **Match play**: "Closed it out 4&3 on the 15th." or "Went the distance — decided on 18."

No LLM call yet; pure client-side narrative from the score deltas. Simple template-based:

```js
function buildMatchNarrative(podium, scores, holePars, format) {
  // detect winning margin
  // detect biggest swing hole
  // detect comeback (lead change in last 3 holes)
  // return a 1-3 sentence summary
}
```

The full LLM-narrated F13 is a future expansion — this is the deterministic v1.

**Risk**: Low. Pure-additive UI section; falls back to nothing if the data is sparse.

### 3B. Per-player scorecard collapsed view

Below the podium, a collapsed `<details>` per player showing their hole-by-hole numbers. Tap to expand. Useful for arguments after the round about who was in the bunker on 14.

**Implementation**: small component reusing `ScorecardCell` but read-only. One `<details>` per player, summary = name + total + diff.

**Risk**: Low.

### 3C. "Play again" CTA

Below "Back to Matches" — a "Rematch" button that calls `POST /api/outings` with the same participants pre-populated. Carries forward course + format. Lands the user in the new match's `CodeShare` screen.

**Risk**: Low-medium. Server route already supports the create signature; just pre-filling the form. Need to confirm the rematch creation flow doesn't double-charge anything (no payments in this app — confirmed safe).

---

## Order of operations

If approved, I'd ship in this order, smallest-blast-radius first, each as its own commit:

1. **Lift `scoreColor` to `client/src/lib/scoreColors.js`** + refactor `PGAScores.jsx` to import. Pure refactor, no behavior change. (~5 min)
2. **Thread 1 — `<MatchScoreboard />` + view toggle**. New component, new toggle button, no edits to scorecard. Verify: toggle flips view, both views read same data, leader gets gold tint, score colors match Tour. (~45 min)
3. **Thread 2A — tap-row jump to scorecard with player focus**. Adds `focusPlayerId` state + scrollIntoView. (~15 min)
4. **Thread 2D — persist NET toggle to localStorage**. (~5 min)
5. **Thread 2E — Clear button in score modal**. (~10 min)
6. **Thread 2B — saved-confirmation toast**. (~10 min)
7. **Thread 2C — per-player active hole**. (~15 min)
8. **Thread 3A — match narrative**. Deterministic template-based. (~25 min)
9. **Thread 3B — per-player scorecard `<details>`**. (~20 min)
10. **Thread 3C — Rematch CTA**. (~20 min)

Total: ~3 hours of work, all in `Outing.jsx` + one new lib file.

After each commit, build locally (`npm run build` in `client/`) and confirm vite parses cleanly, then `git push origin main` for Vercel to auto-deploy. Smoke test on the deployed preview: open an active match, toggle scoreboard ↔ scorecard, verify scores match.

## What I'm explicitly NOT doing in this plan

- **F2 Big Team Battle** — separate scoped session
- **F8 hole-by-hole entry during live play** — actually mostly already done (per-hole entry via the score modal works); the "swipe through holes one at a time" UX is a different flow
- **F9 Spectator mode** (read-only public link) — separate session, needs auth model changes
- **U1 Outing.jsx split** — sliding deeper into "monolith" territory, but a focused refactor session is the right venue
- **LLM-generated match narration** — Thread 3A is the deterministic v1; LLM expansion later

## Approval needed

Two questions for Matt:

1. **Thread 1 specifics**: should the scoreboard view be the *default* on the live match page once 4+ players are in (since the scorecard is wide), or always default to scorecard? My instinct: always default to scorecard (current behavior); user toggles to scoreboard for "let me see who's winning at a glance."

2. **Thread 2 + 3 ordering**: ship Thread 1 alone first and pause to verify, or run the full sequence in one session? My recommendation: ship Thread 1 alone, deploy, you tap through it, then the rest. The scoreboard view is the new visible thing; the polish + recap items are smaller and lower-risk.

## Sources

- `client/src/pages/PGAScores.jsx` — reference layout for the match scoreboard view
- `client/src/pages/Outing.jsx` lines 705 (EndMatchScreen), 1330 (ScorecardCell), 1668 (LiveOuting), 2291 (ScorecardTable), 2602 (TotalsRow)
- [[synthesis/audit-2026-04-29]] — original audit (F2/F8/F9/F13/F14 + U7)
- [[synthesis/audit-fixes-proposal-2026-04-29]] — closed proposal page
