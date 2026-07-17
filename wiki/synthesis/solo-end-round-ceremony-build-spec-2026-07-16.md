---
type: synthesis
created: 2026-07-16
updated: 2026-07-16
tags: [build-spec, solo-round, end-round, scoring, ux, active]
---

# Solo End-Round Ceremony — Build Spec + LIVE Checklist (2026-07-16)

> **Origin:** Matt hit this live on the iOS sim during App-Store screenshot capture.
> Ending a solo round from Eagle Eye dumped him on the Match tab with the summary's
> **Save Round button ~2 screens below the fold**, **no discard option anywhere**, and
> copy claiming "Round Complete" for a round with 0 holes scored. His call:
> *"they should end rounds the exact same way and not be separate"* — and the build
> must be bulletproof: usability, accuracy, visual flow.

## 1. What's broken (verified in code, 2026-07-16)

Seam map (agent-verified, file:line):

- **No discard.** `ScorecardSummary` (`client/src/pages/ActiveRound.jsx:1024-1091`) offers only `💾 Save Round`. The match side got a save-or-discard sheet on 2026-07-09 (`LiveOuting.jsx:3200-3231` — Save & record stats / End without saving / Keep playing, portaled to `<body>`); solo never did.
- **Footer below the fold — two compounding layout causes:**
  - **Cause A:** the pull-to-refresh transform wrapper (`App.jsx:697-705`) between the TabPanel's absolute scroll container and ActiveRound has no height, so `NoPullWrap`/`ScorecardSummary`'s `height:100%` collapses to content height — there is no viewport anchor to pin the footer against.
  - **Cause B:** the summary's middle region uses `className="page-scroll"` (`ActiveRound.jsx:1048`) — but `.page-scroll` (`tokens.css:215-229`) is a **full-tab outer scroller** sized `calc(100dvh - var(--nav-height))`. As an *inner* flex child it forces the column to header + ~viewport + footer tall → the footer always overflows off-screen.
- **Dishonest copy:** header hardcodes "Round Complete" (`:1040`) regardless of holes scored.
- **Trap — stranded phase:** reaching summary and navigating away leaves the autosaved blob at `phase:'scoring'` (autosave gated to scoring, `:1161-1168`; restore accepts only scoring, `lib/solo-round.js:30-48`), so resume drops the user back into scoring, not the summary they were on.
- **Zero regression coverage:** no tests exist for ActiveRound, the summary, or the end flows (nearest: `shot-capture.test.mjs` touches the solo blob only).

## 2. Competitive research synthesis (agent, 2026-07-16 — generic names per the no-competitor-names rule)

Nine leading apps studied (free-rangefinder, stats-subscription, sensor-subscription, handicap-official, handicap-community, watch-ecosystem, scorecard categories). Best-in-class pattern, assembled — no single incumbent does all of it:

1. **Three-way end sheet** — Save (primary) / **Keep playing** (the in-flow undo — the single cheapest, highest-value protection found) / Discard **demoted + confirmed**, never adjacent to Save.
2. **Discard-adjacent-to-Save with no undo is the market's #1 grief generator** (watch-ecosystem forums are full of unrecoverable-round loss).
3. **Partial-round honesty** — "You scored X of 18" with plain-language consequences, not silent defaults.
4. **Ceremony after safety** — payoff (score, stats, share) renders after data is safe; nothing stands between the player and "saved".
5. **Forgiveness copy** — "you can edit this later" is load-bearing; it lets users end confidently.
6. **Data safe by default** — leaders park abandoned rounds as resumable rather than losing them; "End" is a presentation event, not the persistence event. (The Match already has the localStorage blob + session index — this spec closes the summary-phase gap in that story.)

## 2b. Overlap discovery (2026-07-16, after branching off latest main)

Dale's [[synthesis/partial-rounds-stats-build-spec-2026-07-16]] shipped to main **the same day**, covering
this spec's S3 (honest header — "Partial round · X of N holes" + banner + flagged tappable holes +
"Save partial round" button + zero-score save guard, i.e. the "-71" Matt saw on the stale sim build is
already fixed on main). Scope here narrows to what main still lacks: **S1 layout pin, S2 discard +
keep-playing, S4 summary-phase persistence.** D7 of the partial-rounds spec is the copy/content
baseline — this build must not contradict it.

## 3. Design decisions

- **D1 — Same experience as match end.** Solo's ceremony = summary screen with a pinned action stack: **Save Round** (gold primary) → **Keep playing** (secondary, returns to scoring) → **Discard round** (tertiary, red-tinted text link). Match parity, not a new pattern.
- **D2 — Discard is two-step and honest.** Tertiary link opens a `<body>`-portaled confirm sheet (mirrors `LiveOuting.jsx:3200` structurally + tonally): "Nothing will be recorded — your scores from this round will be gone. This can't be undone." Buttons: **Discard round** (red) / **Keep the round** (default). Discard = `clearSavedRound()` (already kind-guards the session index, `:1189-1195`) + reset to setup + `onBack()`. No server call — a solo round is client-only until Save.
- **D3 — Deterministic layout, no parent-chain faith.** ScorecardSummary root gets an explicit `height: calc(100dvh - var(--nav-height))` (the app's established idiom, same floor as `.page-scroll`; iOS 16.4+ dvh is already the app-wide baseline). Header `flexShrink:0`, middle becomes inline `flex:1; overflowY:auto; minHeight:0` (the `SoloScoreboard` idiom at `:801/:837` — the correct sibling pattern), footer `flexShrink:0` with `padding-bottom: max(16px, var(--safe-bottom))`. `.page-scroll` misuse removed.
- **D4 — Honest header.** Fully scored → "Round Complete". Partial → "Round Summary" + subtitle "X of N holes scored — unscored holes won't count." (Server already handles partial rounds correctly; this is presentation honesty.)
- **D5 — Summary phase survives navigation.** Autosave gate widens to `scoring || summary` (blob carries `phase`); `readSavedSoloRound` accepts `'summary'`; ActiveRound restore returns the user to the summary they left. Closes trap #1 in the seam map; aligned with never-lose-your-round.
- **D6 — Out of scope (named, not forgotten):** full shared-ceremony component for solo+match (different data models: client-only vs server `/end`); the match side's `window.confirm` for fully-scored ends; the fragile dual `tm-request-end-round` listeners (exclusivity currently enforced by `Outing.view`, seam-map trap #4); `nextHole()` dead code (`:1249`) — flagged, not touched (no drive-by refactors).

## 4. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | `100dvh` support floor | Already the app-wide baseline (`.page-scroll` uses it everywhere; iOS 15+ target, dvh 16.4+ — accepted precedent, not a new bet) |
| R2 | Widening restore semantics breaks the resume pipeline | `readSavedSoloRound` change is additive (`'scoring'` OR `'summary'`); existing `shot-capture.test.mjs` must stay green; new lib tests pin both phases |
| R3 | Discard wipes a match session | `clearSavedRound` already guards `s?.kind === 'solo'` — discard reuses it, never touches match sessions; test pins this |
| R4 | Portaled confirm sheet z-index clash | Match endPrompt precedent: scrim `zIndex:9999`; EE prompt uses 10000; solo confirm uses 9999 (same layer as match's) |
| R5 | QuickScoreSheet → summary routing regression | No change to that seam (`:1430-1462`); verified in browser pass |
| R6 | Vite builds fine but device ReferenceErrors | The 2026-06-06 lesson: gate = `build` + `lint` (no-undef) + tests, per push discipline |
| R7 | Summary blob restore lands on summary with stale scores | Blob is written on every state change while in scoring AND (new) summary; restore parses the same shape — no new fields |

## 5. Slices + LIVE checklist

- [x] **S0** — Spec + checklist (this doc)
- [x] **S1** — Layout pin ✅ 2026-07-16 (root `calc(100dvh - nav)`, middle flex/overflow, frosted footer bar; sim-verified at 1320×2868 — all three actions on-screen, zero scroll)
- [x] **S2** — Action stack + portaled discard confirm ✅ 2026-07-16 (Save gold primary / Keep playing secondary / Discard red-OUTLINE tertiary; confirm sheet mirrors match endPrompt; design-critique pass same day: frosted grounding bar, no emoji (Matt rule), uppercase eyebrow, 44px+ targets)
- [x] **S3** — Honest header copy — mostly ON MAIN via partial-rounds D7; this build added the 0-scored edge ("Round ended — no scores entered", hero "—" instead of "0 −71") + "(1 hole)" grammar ✅ sim-verified
- [x] **S4** — Summary-phase persistence ✅ 2026-07-16 (autosave gate + lib restore + ActiveRound restore; kill+relaunch restored ONTO the summary twice on the sim)
- [x] **S5** — Tests + gate ✅ 2026-07-16 (9 new tests in `solo-round-phase.test.mjs`; final run: client tests 20/20, eslint exit 0, vite build exit 0, `xcodebuild` BUILD SUCCEEDED)
- [x] **S6** — Verification walk ✅ 2026-07-16 (on the iPhone 17 Pro Max sim, prod-pointed native build: Finish→summary pinned; Keep playing→scoring w/ state intact ("4 thru 1" after re-finish); Discard→confirm→hub, blob+session cleared, verified across relaunch; 0-scored + partial states walked). Honest residuals: save path not executed (no junk round pushed to prod — `saveRound()` diff-verified untouched); QuickScoreSheet seam untouched but not re-walked; web-browser (non-native) walk not done — sim WKWebView is the shipping runtime.
- [ ] **S7** — Matt approves → merge to `main` (beta) → wiki log + handoff updates

**Verify criteria (S6):** at 390px viewport — (a) summary opens with Save/Keep playing/Discard all on-screen, zero scroll; (b) Keep playing returns to scoring with state intact; (c) Discard → confirm → land on setup, blob + session cleared (localStorage inspected), match sessions untouched; (d) partial round shows "X of N holes scored"; (e) reload during summary restores to summary; (f) save path unchanged (achievements event, review offer, blob cleared).

## 6. Execution record

- 2026-07-16 — S0 written. Build on branch `fix/solo-end-round` off origin/main (36017e4).
- 2026-07-16 — S1–S6 built + verified same session. Files: `client/src/pages/ActiveRound.jsx` (+129/−35 area), `client/src/lib/solo-round.js`, `client/src/lib/__tests__/solo-round-phase.test.mjs` (new), `client/package.json` (test script + react pin, see below). UNCOMMITTED — awaiting Matt's S7 approval.
- **Incident (root-caused, not this fix):** first native build white-screened on the sim. Audited via Chrome console on the same bundle: React error #527 — `react-dom 19.2.7` vs `react 19.2.5` mismatch in node_modules (`^19.0.0` ranges drifted across installs). Fix: pin both to `^19.2.7` (client/package.json + lockfile). The bundle rendered immediately after; zero relation to the ceremony changes. ⚠️ This means the react/react-dom bump RIDES ON THIS BRANCH — call it out at merge.
- Design-critique pass (Matt, same day: "buttons look trash… discard round not a button… no emojis… high-end flawless"): frosted footer bar grounding the action stack, red-outline destructive button (match-sheet pattern, 44px), emoji stripped from Save label + post-save screen, uppercase letter-spaced eyebrow. Sim re-verified after rebuild.
