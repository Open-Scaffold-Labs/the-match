---
type: synthesis
created: 2026-06-30
updated: 2026-06-30
tags: [the-match, handoff, eagle-eye, plays-like, phase-0, accuracy]
---

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
