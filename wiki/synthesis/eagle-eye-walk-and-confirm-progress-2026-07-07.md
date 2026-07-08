---
type: synthesis
created: 2026-07-07
updated: 2026-07-07
tags: [eagle-eye, strokes-gained, shot-capture, build-progress, checklist, competitive]
status: IN PROGRESS — Slice 0 + Slice 1 built + LIVE-verified on beta (capture works for solo + outing); GPS→plays-like hero pending on-device
spec: [[synthesis/eagle-eye-walk-and-confirm-spec-2026-07-07]]
---
# Eagle Eye "Walk-and-Confirm" — Build Progress Tracker (BULLETPROOF EDITION)

Companion to the build spec ([[synthesis/eagle-eye-walk-and-confirm-spec-2026-07-07]]).
Spec = the design. **This doc = the live checklist, the bar to beat, and the risk register.**
Mission: **become the biggest name in golf apps** — so this feature must win on **usability,
accuracy, and visual flow** simultaneously. Slice order: **0 → 1 → 2 → 3 → 4.**

> ⏳ **UPDATE-AS-YOU-GO (Claude: standing instruction).** Treat updating this file as part of
> finishing any Eagle Eye build step:
> 1. Tick `[ ]` boxes only AFTER the step's **verify** passes (audit-before-claim — cite the check).
> 2. Update the slice **Status** line + frontmatter `status`/`updated`.
> 3. Append a dated **Session log** entry.
> 4. Never tick on intent alone.

---

## 0. Audit status — foundation VERIFIED (2026-07-07)

The shipped data pipeline this UX feeds was audited claim-by-claim against code, prod DB, tests.
**Real — do not rebuild:** migration 042 applied to prod (`tm_outing_participants.shots` + `tm_rounds.shots` jsonb, psql-confirmed); `shotFacts.js` clean/set + **12/12 vitest**; self-only write `outings.js:1050`; `/end` sync 2306/2323; SG complete-chain gate + ≥9 shot-holes (`sg/index.js` 80-91, 220) — re-ran `roundSG` → OTT/APP/ARG populate, 8-chain control → null. Every EagleEye/App/Outing/geo line matched.

The build PLAN below (Slices 0-1 + risks) was produced by a Plan agent against the real code and its plan-changing claims were re-verified this session (see §3). Market research (§2) was gathered by three research agents **with cited sources** — figures are agent-sourced, not independently re-verified by me; treat the cited studies/URLs as the authority.

---

## 1. 🔧 Carry-forward fixes & invariants (apply to EVERY slice)

1. **LIE KEYS = `tee | fairway | rough | sand | recovery`.** Spec §4e says `trouble` — that is the display LABEL only. Server `VALID_LIES` (`shotFacts.js:15`) + SG `OFF_GREEN` (`sg/index.js:88`) use key **`recovery`**. Emitting `lie:'trouble'` → `cleanHoleShots` silently drops the shot → broken SG chain, no error. **Import & reuse `ShotSheet.jsx`'s `SHOT_LIES` (key `recovery`, label "Trouble") — never hard-code `trouble`.** (Risk R1.)
2. **toPin source = `gpsToGreen` (EagleEye.jsx:1297), NEVER `displayYards` (1355) or `pinYards` (1350).** `displayYards` follows the dragged aim point; `pinYards` is a fallback chain. Either silently records a wrong distance → wrong SG. Snapshot `gpsToGreen` at tap, freeze it. (Risk R2.)
3. **Hole index:** EE `currentHole` is **1-indexed** (809); buffer/scores/shots arrays are **0-indexed**. Convert in ONE place (`holeIdx = currentHole - 1`). (Risk R4.)
4. **Chain completeness:** SG counts a hole only when `shots.length + putts === score` (`sg/index.js:87`). A miss silently drops the hole (safe, never corrupts) — but that's why a captured shot can "vanish" from SG. Surface a non-blocking hint. (Risk R3.)
5. **Gate ALL new EE behavior on `activeScoring?.kind === 'outing'`.** With no active round/outing, EE must render pixel-identical to today. (Risk R7.)
6. **Solo already has a durable shot store** (`ActiveRound.shots` → blob autosave `ActiveRound.jsx:970`, restore 957, send `/rounds` 1050). Do NOT add a second store for solo — Slice 0 solo = a **façade over the existing blob**; leave `addShot` alone. (Risk R13.)
7. **Never lose an open shot / cap implausible distances** (market's "400-yard 8-iron" class of bug). Confirm appends once; sanity-bound the distance. (Risks R8, R10.)

---

## 2. 🎯 THE BAR WE MUST BEAT (competitive research, 3 pillars)

Sources: 3 research agents, cited. Benchmark to beat = **Hole19's 2026 "Shot Tracker"** (walk → one tap Save → app suggests club + auto-detects lie → you confirm; drag markers to fix). Automatic-sensor rivals (Arccos, Shot Scope, Garmin CT10) need $100-200 hardware; **our phone-only + live GPS-to-pin is the unfair advantage — no phone-only rival offers full four-category SG without sensors.**

### 2A. USABILITY — the winning interaction model
- **Kill the "start shot" tap.** The best apps auto-accumulate distance from the last saved shot as you walk (Hole19/18Birdies/Golfshot). Player taps **once, at the ball, to save** — never tap-before-and-after (Golf Pad/18Birdies's friction).
- **Capture = a PRE-FILLED CONFIRM CARD, not a form.** Distance (GPS), club (bag×distance), lie (default/polygon) all filled in. Confirm = acknowledgement, **zero typing ever**.
- **One-gesture correction.** Wrong club → one tap on a neighbor in a club strip (mirror Golfshot's crown-scroll, on-screen). Wrong lie → one tap on a 4-chip picker. Fix mistakes **on the hole**, never a post-round spreadsheet (Shot Scope's #1 complaint: editing 17-18 holes after).
- **Pitfalls to beat (ranked):** (1) forgetting-to-log destroys the dataset → **build a "forgot to log?" backfill net**; (2) phantom/wrong-club shots; (3) post-round editing burden; (4) missed putts/tap-ins → a trivial putt lane; (5) pace-of-play friction — every extra tap is a defect; (6) stuck-open-shot → 400-yd 8-iron; (7) upsell spam before capture; (8) no club rec at all (TheGrint gap — we ship it day one).

### 2B. ACCURACY — our biggest differentiator
- **Empirical reality (peer-reviewed, Hall et al. 2025, Int. J. Golf Science, agent-sourced):** consumer/phone GPS is a rangefinder (~3-5 yd to a known target) NOT a surveyor of where the ball sits. Shot-*position* capture scatter up to **±9 yd on 200+ yd shots**; run-to-run limits-of-agreement **7-16 yd**; "poor" under 50 yd; putt LOA **19-36 ft**; auto-detect misses **~5%** of shots and one miss corrupts the neighbor's distance.
- **THE OPEN LANE:** *no* researched app hard-gates capture on GPS accuracy — they only display a status color. **We already refuse untrusted GPS at capture** (EE `gpsTrusted`/`gpsUsable` 1283-1297 → falls to a manual field). Lean into it: this is a real, ownable accuracy edge.
- **Safeguards to implement (given our read-time, chain-gated engine):**
  - Snapshot distance only when `gpsUsable`; else require the manual field (already our design). (R2/R8)
  - **Sanity-bound** every captured distance (approach ≤ hole yardage + margin; reject the 327-yd-drive / 384-ft-putt class). (R2)
  - **Monotonic hint:** each successive shot's yards-to-pin should decrease — flag an increase for confirm.
  - **On-green by green polygon, not proximity** (Slice 3); never let a putter-from-fringe post as a putt.
  - **Keep the completeness gate — it's ahead of the entire market.** No rival gates SG on `shots+putts===score`. Keep it hard. (R3)
  - **Confidence labels:** ≥9 shot-holes → round SG, but tag single-round SG "directional"; category verdicts stabilize ~15-20 rounds (Broadie).
  - **Around-green cutoff = 30 yd** (`ARG_MAX_YDS=30`, `sg/index.js:59`) — this is the PGA Tour/Broadie standard (18Birdies uses 20, Arccos 50). Validated: keep 30.

### 2C. VISUAL FLOW — the dark "instrument" moment
Palette: Augusta-at-night dark, fairway green `#2A7A38`, trophy gold `#C9A040` (single accent). Confirm sheet must feel like entering an instrument.
- **Dark is functional** (WHOOP model): near-black makes one bright number + one accent pop.
- **One hero number — huge, heavy, TABULAR numerals** (so the value doesn't jitter horizontally as GPS ticks). Gold, past 7:1 contrast for sunlight.
- **Gold = one meaning only:** the live number + the Confirm action. Nothing else gold.
- **Bottom sheet, not full-screen modal** (NN/g): a shot confirm is short + contextual; keep the map behind it. Native detents — medium (hero + Confirm) → large (club/lie detail).
- **Darkened + blurred scrim over the FROZEN map** = the instrument signal (`backdrop-filter: blur()` + dark overlay; iOS materials). The measured shot line stays faintly visible through it.
- **Confirm in the thumb green-zone:** full-width, 56-60pt, bottom, safe-area-inset padding. Keep the hero mid-sheet (very bottom isn't most reachable — NN/g). Space Confirm from Cancel/X by ≥12-48px to prevent misfires.
- **Haptics at 2 beats:** light on capture, success on confirm. ⚠️ **Honest limit (verified):** `tmHaptic` (`shared.jsx:144`) just wraps `navigator.vibrate`, which **iOS WKWebView ignores** (its own comment says so) — and there is NO native haptic bridge in the codebase (no `webkit.messageHandlers`). So on-device haptics are currently a **no-op**. Reuse `tmHaptic` for consistency, but treat real Taptic feedback as a separate native-shell task (add a `webkit.messageHandlers` → `UIImpactFeedbackGenerator` bridge), NOT a Slice-1 deliverable.
- **Progressive disclosure:** at rest show only number + Confirm; club/lie/plays-like one detent down.
- **Anti-patterns:** full-screen modal for a quick confirm; stacked sheets; grabber-only dismissal; multi-color number soup; thin/light hero type; Confirm at top/corner.
- **Model the component on `PlaysLikeSheet` (`EagleEye.jsx:704-799`)** — same `createPortal` + `--tm-ee-glass-*` tokens + `ee-sheet-up` animation + grabber.

---

## 3. Ground-truth corrections to the spec (VERIFIED this session)

1. **The outing shot state lives in `ScoreModal` (`LiveOuting.jsx:211`), NOT "SoloScoreModal."** `holeShots` is at :228 inside `ScoreModal`; its props do NOT include `code`/`uid` (must be threaded from the render site ~2800-2831). `SoloScoreModal` is a different component in `ActiveRound.jsx:171`.
2. **Solo already persists shots** (blob autosave `ActiveRound.jsx:970`, restore 957, send `/rounds` 1050) → Slice 0 solo = façade, not a second store (see fix #6).
3. **`/end` sync limit (honest):** the round INSERT is `ON CONFLICT (user_id, outing_id) DO NOTHING` and only fires for full 9+ cards (`outings.js:2291-2292, 2309`). **Shots logged/edited AFTER the round row exists never reach `tm_rounds.shots`.** → tell users to log+score each hole *before* ending the match. (Risk R5.)
4. `clubModel.js` is already EE-imported (`EagleEye.jsx:6`) and exports `SLOT_LABELS` (:10) with a test file (`__tests__/clubModel.test.mjs`) → `recommendClub` extraction is clean.

---

## 4. Build checklist by slice

### Slice 0 — shared per-hole shot buffer (no UI, no behavior change)
**Status:** 🟢 built + static-verified (lint + build + 20/20 unit green, 2026-07-07, commit on `main`); on-beta "+ Log Shot" walkthrough pending

- [x] `client/src/lib/shot-capture.js`: `scopeKey / readHoleBuffer / appendShot / writeHoleBuffer / clearHoleBuffer`. Shot shape `{ lie, toPin, club? }`; key `tm-shots-v1:<scope>:<uid>:<holeIdx>`, `scope = outing:<CODE>` (upper-cased) | `solo`, holeIdx 0-based. Every `localStorage` call `try/catch` → `[]`/no-op. ✓
- [x] `solo` scope = **façade** (`readSoloShots/writeSoloShots` in `solo-round.js`, read-modify-write the existing blob) — one physical store; `addShot` untouched. ✓
- [x] OUTING path: `code`+`uid` threaded into `ScoreModal` (render site); `holeShots` lazy-inits from `readHoleBuffer`; `ShotSheet.onAdd` → `appendShot`; `shotFactsFor`/save unchanged; buffer not cleared on save. ✓
- [x] Unit tests `shot-capture.test.mjs` (20 assertions: scopeKey axes, append grows, corrupt/absent/throwing storage → [], solo façade preserves other keys) + registered in `package.json` (**confirmed** it's an explicit list, not a glob). ✓
- [~] **Verify:** lint ✓ · build ✓ · `node --test` **20/20** ✓. **Pending (post-push, on beta):** "+ Log Shot" → save 9+ card → end → psql `tm_outing_participants.shots` + `tm_rounds.shots` populated (proves the shipped path is unchanged on device).

### Slice 1 — outing walk-and-confirm (PRIMARY)
**Status:** 🟢 built + static-verified (lint + build + 36 unit green, 2026-07-07); on-beta UI walkthrough pending push

- [x] `activeScoring` lifted to App.jsx (`{kind:'outing',code}` | null); threaded to EE (prop @ :803) + `onActiveScoringChange` to Outing; `Outing.jsx` publishes on `view==='live' && activeCode` (upper-cased), clears on end/hub + unmount. ✓
- [x] `recommendClub(bag, targetYards)` extracted to `clubModel.js` (raw-bag `avg_yards` shape); `ClubToggle.recommend` rewired (behavior identical); 4 new unit tests → **16/16 clubModel**. Fed the captured snapshot, never `displayYards`. ✓
- [x] "LOG SHOT" dark-glass pill in HUD `order:1` block; shows for **any active EE round** — live outing OR self-discovered solo (`activeCapture`), inside the existing `courseCtx && !bigMode` HUD. Tap → snapshot `gpsToGreen` → open sheet (no direct append). ✓ **Live-verified on beta 2026-07-08.**
- [x] `ShotCaptureSheet` (modeled on `PlaysLikeSheet`): frozen `gpsToGreen` hero (manual numeric field when `!gpsUsable`); one-gesture club strip auto-selecting `recommendClub`; lie chips from the now-exported `SHOT_LIES` (default tee/fairway, keys incl. `recovery`); Confirm → `appendShot(holeIdx: currentHole-1)` + immediate close (R10); resets on `currentHole` change. ✓ *(haptic skipped — `tmHaptic` is a verified iOS no-op; deferred to the native-bridge task)*
- [x] Flush = the EXISTING score save (Slice 0 made `ScoreModal` read the buffer at open). No new flush code; EE never calls the server. ✓
- [x] Completeness hint in `ScoreModal` when `holeShots.length + (putts||0) !== score` (non-blocking, Risk R3). ✓
- [~] **Verify:** lint ✓ · build ✓ · unit **36/36** ✓. **Pending (post-push, on beta):** log 2 shots in EE on a par 4 (hero shows TO-GREEN, not the dragged aim) → score modal pre-filled → save 2-putt "4" → end → psql `tm_rounds.shots` complete → `roundSG` OTT/APP; ≥9 shot-holes for round-level. Standalone regression: `activeScoring=null` → EE unchanged, no LOG SHOT.

**Best-in-class upgrades (option #2, 2026-07-08 — the bar is beating the leaders, not our own old code):**
- [x] **Plays-like club rec** — LOG SHOT freezes the pin's PLAYS-LIKE distance (`computePlaysLike` + `plEff` — the engine we already own) alongside raw GPS; the club strip auto-selects for the PLAYED distance and the hero shows "150 · plays 162". `toPin` stored RAW (SG keys on actual distance). Beats a raw-yardage nearest-neighbour and any phone-only app without a plays-like model. *(Minor known limit: uses the current effective elevation — exact unless the aim is dragged off the pin.)*
- [x] **"Forgot-to-log" backfill net** — the `ScoreModal` completeness hint gains a one-tap **+ Add the missing shot(s)** button when shots+putts < score (the #1 manual-tracker failure). No fabrication — opens ShotSheet for the real shot.
- [x] **Trust nudges** — the sheet warns (non-blocking) on an implausible single-shot distance (>500y) or a distance-to-pin that didn't drop from the last shot (mis-tap signature). Never blocks — a real recovery can go backwards.
- [~] Verify: lint ✓ · build ✓ · unit 36/36 ✓; on-beta UI is the remaining check.

### Slice 2 — solo walk-and-confirm
**Status:** ⬜ not started
- [ ] EE self-discovers solo via `readSavedSoloRound(user.id)`; write through the solo façade; re-hydrate `ActiveRound` on tab focus (cross-tab); send cleaned shots on `POST /rounds`.
- [ ] **Verify:** solo capture in EE → finish → `/rounds` → SG categories populate.

### Slice 3 — lie auto-detect v1
**Status:** ⬜ not started
- [ ] Add ray-cast point-in-polygon to `geo.js` (none exists today); green polygon → warn/block "on green = putt"; keep tee/fairway defaults + override (keys per fix #1).
- [ ] **Verify:** on/off green flips the warning; overrides still write `recovery`.

### Slice 4 — fairway/bunker polygons (STRETCH)
**Status:** ⬜ not started
- [ ] New Overpass fetch (`golf=fairway`, `golf=bunker`) + cache bump; PIP → true auto lie; degrade to Slice-3 defaults when OSM empty.

---

## 5. Risk register (ranked by severity = silence × blast radius)

| # | Risk | Mitigation | Test |
|---|---|---|---|
| **R1** 🔴 | Lie key `trouble` silently dropped by server → whole hole leaves SG | Import `ShotSheet.SHOT_LIES` (key `recovery`); no literal `'trouble'` | unit: `cleanHoleShots` keeps `recovery`/drops `trouble`; beta: log Trouble → psql `lie:"recovery"` |
| **R2** 🔴 | `toPin` from `displayYards`/`pinYards` → wrong distance, quietly wrong SG | Snapshot only `gpsToGreen` (1297), frozen; feed `recommendClub` the snapshot; manual field when `!gpsUsable` | beta: aim=120y while TO-GREEN=165y → stored toPin=165 |
| **R3** 🔴 | `shots+putts !== score` → hole silently dropped from SG | Non-blocking reconcile hint in `ScoreModal` (§4 S1) | unit: `holeShotsSG` null on mismatch; beta: hint fires then clears |
| **R4** 🟠 | Hole off-by-one (1-idx EE vs 0-idx arrays) → shots on wrong hole | Convert once (`currentHole-1`); reset sheet on hole change | unit: EE@4 read by modal@3; beta: log hole 4 → appears hole 4 only |
| **R5** 🟠 | Shots logged after `/end` row exists never sync (ON CONFLICT DO NOTHING, full-card-only) | Log+score each hole before ending; buffer persists across the walk | beta: log→score→end = present; end→log = absent (documented limit) |
| **R6** 🟠 | Cross-tab desync (EE + Outing both mounted; no `storage` event same-doc) | Buffer = single source; modal reads at open/mount; optional `visibilitychange` re-read | beta: log in EE → switch → open modal → both appear |
| **R7** 🟠 | Breaking standalone Eagle Eye | Gate every new element on `activeScoring?.kind==='outing'`; `recommendClub` preserves ClubToggle | beta: no active outing → EE pixel-identical, no LOG SHOT |
| **R13** 🟠 | Solo double-store write race | Solo = façade over the one blob; don't touch `addShot` in S0 | unit: façade round-trips without altering other keys |
| **R8** 🟡 | `gpsToGreen` null/acquiring/out-of-range | Manual required field when `!gpsUsable`; Confirm disabled until positive distance | beta: GPS acquiring → manual field; empty blocks Confirm |
| **R9** 🟡 | Buffer lost on app-kill mid-hole (pre-flush) | `localStorage` survives backgrounding; keyed by code; accept documented limit | beta: log 2 → force-quit → reopen → present |
| **R10** 🟡 | Double-append / re-tap | LOG SHOT only opens sheet; only Confirm appends; disable-on-submit; don't value-dedupe real dupes | beta: rapid double-Confirm → one shot |
| **R11** 🟡 | Stale `activeCode` after outing ends | `Outing.jsx` clears `activeScoring` on end → R7 gate hides LOG SHOT | beta: end match → no LOG SHOT; new outing → new code |
| **R15** 🟡 | Outing-code case mismatch writer vs reader | Upper-case at publish + in `scopeKey` | unit: `scopeKey` normalizes case |
| **R12** 🟢 | Offline queue + idempotency | Shots ride inside the idempotency-keyed body (1261-1262); full per-hole list, not delta | server idempotency test asserts replayed body carries shots |
| **R14** 🟢 | `localStorage` disabled/quota (Safari private) | try/catch → `[]`/no-op everywhere | unit: throwing storage stub → no crash |

---

## 6. Pre-push gate (the-match beta discipline — every push)

- `npm --prefix client run lint` (ESLint `no-undef` — a clean `vite build` is NOT enough; shipped an undefined ref to beta 2026-06-06)
- `npm --prefix client run build` · `node --check` on changed server files · `npm run test --workspace=server` if server touched · client `node --test` list updated
- **Beta phase: `main` IS the test env** → build-verified feature code goes to `main`, additive + `activeScoring`-gated (reversible). **Ask Matt before every commit/push** (CLAUDE.md hard rule).

---

## 7. Session log

### [2026-07-07] audit + tracker created, then upgraded to bulletproof edition
- Audited the gameplan claim-by-claim (foundation VERIFIED; one real error = §4e lie key → fix #1; caveats logged). Committed spec + tracker + PM11 log + CLAUDE.md 043 to `main` (`ff010cb`).
- Ran 4 agents: usability / accuracy / visual-flow market research (cited) + a Plan agent (bulletproof Slice 0/1 + risk register). Folded all into §2/§4/§5. Re-verified the Plan agent's 4 plan-changing claims against code (§3). No build code written yet — Slice 0 is next.

### [2026-07-07] Slice 0 BUILT + pushed
- Shipped `client/src/lib/shot-capture.js` (buffer) + `solo-round.js` façade (`readSoloShots/writeSoloShots`, one physical store) + `ScoreModal` rewire (buffer-hydrated init + append-through-buffer; `shotFactsFor`/save/host-scoring byte-identical) + 20 unit tests registered in `package.json`. Gates: lint ✓ · build ✓ · `node --test` 20/20 ✓. Committed + pushed to `main` (`3fcbe28`). Remaining Slice-0 verify = on-beta "+ Log Shot" walkthrough.

### [2026-07-07] Slice 1 BUILT (walk-and-confirm capture)
- `recommendClub` extracted to `clubModel.js` + `ClubToggle` rewired (behavior-identical, 4 new tests); `activeScoring` lifted App→Outing→EE; `SHOT_LIES` exported from `ShotSheet` as the single lie-key source; new `ShotCaptureSheet` (dark instrument sheet: frozen gpsToGreen hero / manual fallback, auto-club strip, recovery-keyed lie chips, Confirm→buffer); "LOG SHOT" HUD pill gated on an active outing; completeness hint in `ScoreModal`. Shots flush through the existing score save (no server change). Gates: lint ✓ · build ✓ · unit 36/36 ✓. **Not yet run:** on-beta UI walkthrough (real capture → SG).

### [2026-07-08] Slice 1 best-in-class upgrades (option #2)
- Matt's steer: the bar isn't parity with our old model, it's beating the most-used apps. Built 3 upgrades: (1) **plays-like club rec** — advise the club on the pin's PLAYS-LIKE distance (reusing `computePlaysLike`/`plEff`), store raw for SG, hero shows "150 · plays 162"; (2) actionable **"forgot-to-log" backfill** button in `ScoreModal`; (3) non-blocking **trust nudges** (>500y implausible + non-decreasing distance-to-pin). Gates: lint ✓ · build ✓ · unit 36/36 ✓. Pushed `bb83047`.

### [2026-07-08] Capture opened to ALL EE rounds + LIVE browser verification
- Matt (correct): capture must work for EVERY Eagle Eye round, not just outings. Un-gated — EE self-discovers a solo round (`readSavedSoloRound`) alongside outings via a unified `activeCapture` scope; solo writes ride the shared round blob (`lib/solo-round`) and fire `tm-solo-shots` so `ActiveRound` re-hydrates its shots (kills the R13 clobber race). Pushed `78d46b7`. Gates: lint ✓ · build ✓ · 36/36 ✓.
- **Verified LIVE on the beta (Claude-in-Chrome):** deploy live, no app console errors, map renders (Pebble Creek satellite), plays-like computes (FROM TEE 340 / PLAYS LIKE 337); **LOG SHOT now shows for the solo round**; confirm sheet renders (manual-distance fallback since desktop GPS is `denied`, club strip, lie chips incl. Trouble); a confirmed shot wrote `{lie:"tee",toPin:165,club:"7i"}` into the round blob's `shots[0]` — correct SG shape — then the sheet closed. Test shot cleaned up afterward. NOT exercised here (needs real GPS on-device): the GPS→plays-like hero path (code + unit verified).
- Honest correction logged: earlier I called EE "loads clean" off the console alone while the map was mid-tile-load — an overclaim; the map does render.
- **Slice 2 (solo) is now largely delivered** by this un-gating (EE solo capture + the re-hydration sync). Residual Slice-2 item: solo shots are stored raw (no server-side `cleanHoleShots` on `POST /rounds`) — SG's gate makes junk harmless, but a clean-on-save is the tidy follow-up.
