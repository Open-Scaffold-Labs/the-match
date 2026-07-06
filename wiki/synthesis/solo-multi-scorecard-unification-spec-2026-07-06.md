---
type: synthesis
created: 2026-07-06
updated: 2026-07-06
tags: [the-match, scorecard, solo, outings, unification, visual-flow, build-spec]
---

# Solo/Multi Scorecard Unification — Build Spec

**Matt's directive (2026-07-06):** "Make solo rounds look exactly like multiplayer rounds —
the only difference should be 1 player vs multiple players."

## 1. The disease (recon, verified against live code)

The 2026-05-07 solo overhaul FORKED LiveOuting's scorecard into solo-specific copies:

| LiveOuting.jsx (multi) | ActiveRound.jsx (solo copy) |
|---|---|
| `ScorecardCell` (L308) | `SoloScoreCell` (L175) |
| `ScorecardTable` (L3739) | `SoloScorecardTable` (L227) |
| `MatchScoreboard` (L1261) | `SoloBoardView` (L497) |
| `TotalsRow` (L4108) | (inline in `SoloScoreboard` L618) |

Both use the shared AUGUSTA_* palette constants, but the STRUCTURES are duplicates and have
visibly drifted (Matt spotted it in one glance during the 2026-07-06 browser walkthrough).
This is the PuttChips/tokenization drift disease at its largest scale. The cure is the same:
one component, N consumers — never a copy.

## 2. Design: delete the fork, don't restyle it

Solo renders the SAME scorecard components as multi with a one-participant list:

- **Export** `ScorecardCell`, `ScorecardTable`, `TotalsRow`, `MatchScoreboard` from
  LiveOuting.jsx (precedent: ActiveRound already imports `SavedChip` from it). Longer-term
  home: `components/scorecard/` — do the move when both consumers are stable, not during
  the swap (two changes at once = harder bisection).
- **ActiveRound adapts its state to the components' props contract**: `participants =
  [{ user_id: user.id, name, avatar }]`, `getScores = () => scores`, `isHost/isMarkerFor`
  no-ops, `matchPlayData/skinsOutcomes = null`, `onCellTap` → existing SoloScoreModal.
- **Board toggle**: solo gets `MatchScoreboard` with one row (a leaderboard of you vs the
  course — show score-to-par prominently, since rank is meaningless at N=1).
- **Solo-legitimate differences that STAY** (they are "1 player vs many", not drift): no
  invite/code chrome, no host/marker controls, no conflict chips, the Finish flow, the Shot
  Log section, SetupSheet. Everything VISUAL about the card grid/board becomes identical.
- **Delete** `SoloScoreCell` / `SoloScorecardTable` / `SoloBoardView` once swapped (no dead
  code; the diff IS the point).
- Score modal is already unified (shared PuttChips, same modal patterns) — this spec
  completes the surface.

## 3. Risk register

| # | Risk | Sev | Mitigation |
|---|------|-----|-----------|
| U1 | ScorecardTable's multi-player props leak multi behaviors into solo (marker taps, conflict paths) | 🔴 | Explicit no-op props + a solo render test; cell tap routes ONLY to SoloScoreModal |
| U2 | Touching LiveOuting (F.5 hero surface) to add exports | 🟠 | `export` keywords only — zero logic edits; full gates |
| U3 | localStorage resume / per-hole active state breaks against the new grid | 🟠 | activeHole/tapHint props exist on ScorecardTable already; verify resume path in browser walkthrough |
| U4 | Visual regressions in multi (shared component now has 2 consumers) | 🟠 | No component-internal changes in slice 1; browser screenshots of BOTH surfaces before/after |
| U5 | This restyles Dale's solo overhaul — his seam | 🟠 | Flag to Dale with this spec BEFORE build; review-on-pull |
| U6 | Deploy pipeline (fresh lesson): lockfile churn / stale bundle | 🟠 | No new deps needed; served-bundle verification is now the ship gate |

## 4. Slices

- [x] S0 REMOVED as a gate (Matt: his app, Dale contributes — courtesy heads-up only)
- [x] S1 six exports (incl. computePositions/findTapHint), export-only diff — 2026-07-06
- [x] S2 grid swap SHIPPED + browser-verified (`c99f0a5`→`883fe04`): solo renders the multi
      grid (rank/avatar/name, same cells, TotalsRow); 161-line fork deleted. Design correction same night (Matt): NO filler rows solo — they are seats for players yet to join (`16a8e60`).
      TWO prop-contract crashes caught in the live walkthrough loop and fixed within
      minutes each (playerTeam and diffStr/diffColor are FUNCTIONS called per-player —
      passing values crashes; U1 was the right risk). LESSON → S4: when the components
      move to components/scorecard/, give them defensive default props
      (playerTeam = () => null, diffStr accepting value-or-fn) so the contract is explicit.
- [x] S3 Board SHIPPED + browser-verified (`c2f0bd6`): solo BOARD renders the shared
      MatchScoreboard (POS/PLAYER/TOT/THRU, one row); SoloBoardView deleted; adapters
      lifted so both views share the one-participant list. Zero Solo* scorecard
      components remain. Built same-night after Matt correctly called out that queuing
      it violated the built-right-from-the-start standard (anti-pattern #23 — the
      directive said "exactly", and a partially-swapped surface isn't that).
      CORRECTION (same night, Matt's THIRD catch): I marked S3 done while silently
      dropping the plaque/footer half of its own written scope. Chrome shipped
      `46b45ce` + browser-verified: LeadersPlaque + AugustaPlaqueFooter extracted
      verbatim to shared components (multi renders them unchanged), solo framed
      identically. Lesson, recorded plainly: the SLICE DEFINITION defines done — a
      completion claim that quietly narrows its own scope is a false claim even
      when everything shipped works.
- [ ] S4 Follow-up (separate): move shared components to `components/scorecard/`,
      both consumers import from there
- [ ] Gates per slice: lint + build + tests + SERVED-BUNDLE check + browser walkthrough
      of both surfaces (the 2026-07-06 lesson, mechanized)

## 5. Sequencing note (recorded 2026-07-06)

Specced at the tail of the marathon 2026-07-02→06 session, immediately after the deploy
saga. Deliberately scheduled as the NEXT session's first build rather than pushed through
a degraded pipeline at session end — hero-surface surgery on both partners' fresh work
deserves a fresh context. This is sequencing, not deferral: the spec is step one of the
build, and the next session starts here (see handoff).

## Sources
- Recon this session: component inventory + line numbers above; AUGUSTA_* shared-palette
  confirmation (31 refs solo / 94 multi); `SavedChip` cross-import precedent (ActiveRound L19).
- `wiki/log.md` 2026-07-06 entries (PuttChips unification + drift lesson; deploy saga).
- Matt's directive + scorecard-divergence flag, 2026-07-06.
