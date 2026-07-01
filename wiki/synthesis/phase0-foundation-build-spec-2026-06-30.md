---
type: synthesis
created: 2026-06-30
updated: 2026-06-30
tags: [the-match, phase-0, foundation, design-system, eagle-eye, visual-flow, build-spec]
---

# The Match — Phase 0 Foundation: Bulletproof Build Spec & Progress Checklist

*Greenlit by Matt 2026-06-30: "perfect this in terms of usability, accuracy, and visual flow… become the biggest name in golf apps worldwide."*
*Inputs: codebase ground-truth audit (this session) · two cited research reports — competitor golf-app UX (`golf-app-foundation-ux-research.md`) + premium-foundation best practices (`the-match-foundation-research.md`). Competitors referred to generically per the no-competitor-names rule.*

---

## 0. Read this first — the status correction (audit-before-claim)

The 2026-06-29 handoff and the premium plan's status note both say **"Phase 0: NONE done."** That is **not accurate**, and building on it would have meant redoing work. Ground-truth from `client/src/design/tokens.css` + a codebase grep:

| Phase 0 item | Doc said | **Reality (verified this session)** |
|---|---|---|
| Tabular numerals app-wide | not done | **DONE** — `body { font-variant-numeric: tabular-nums; font-feature-settings:"tnum" }` + `.tm-nums` utility (tokens.css L141-147, 323). Applied globally at `body`. |
| Dark-elevation tokens | not done | **DEFINED + partially applied** — `--tm-dark-0..3`, `--tm-dark-text/-2` exist (L83-88); used **only in Practice.jsx (43×) + App.jsx (1×)**. Eagle Eye / HoleMapGL still use bespoke inline hex. |
| Layered shadow token | not done | **DEFINED, UNUSED** — `--tm-shadow-layered` / `.tm-shadow-layered` exist (L92-97, 326) but **0 component uses them**. |
| Glass HUD | not done | **DEFINED, UNUSED in components** — `.tm-glass` exists (L331-340); used by the Eagle Eye HUD via inline styles, not the class (to confirm during build). |
| Motion easings | not done | **DEFINED** — `--tm-ease-out`/`--tm-ease-in` (L77-78); base utility classes still reference the older `--tm-ease`. No app-wide audit done. |
| Type system (custom font) | not done | **NOT done** — system fonts only (`-apple-system…`, L137). No `@font-face`, no Fontsource. ✔ truly open. |
| Grain overlay | not done | **NOT done** — no `feTurbulence` anywhere (the only "grain" hit is an unrelated wood-grain gradient in `LiveOuting.jsx`). ✔ truly open. |

**Honest Phase 0 status: ~40% scaffolded, ~0% finished.** A 2026-06-23 "premium pass" laid token *definitions* for elevation, layered shadow, glass, and motion — but **defining a token ≠ applying it.** The real Phase 0 work is *application + coverage + the two genuinely-missing pieces (type identity, grain)*, not green-fielding the tokens. This spec is scoped to that reality. (Trust-anchor refresh: the stale "NONE done" lines in the handoff + premium plan will be corrected at end-of-session per CLAUDE.md.)

---

## 1. Strategic thesis — why Phase 0 is the highest-leverage work we can do

Foundation is the **substrate every other screen renders on.** The Eagle Eye hero instrument already shipped (MapLibre, flyTo, arc gauge, glass HUD, plays-like, own-club arcs). The accuracy track and the entire F.5 "never lose your round" rework are complete. What separates us from "good golf app" and "the biggest name worldwide" is the *crafted-polish* pillar of our own thesis — and that pillar lives in the foundation: type, numerals, depth, motion, texture. Get it right once and **every** screen inherits premium feel; get it wrong and we re-litigate it screen by screen forever.

**The competitive opening is unusually wide (research-backed).** Across the most-used golf apps, the foundation layer is *undocumented and largely unbuilt*:
- **No competitor has a documented tabular-numeral system.** Proportional digits visibly "jitter" as yardage/score ticks. We already enabled `tnum` app-wide — we are likely *already ahead*; the job is to prove it and not regress.
- **Confirmed HUDs are flat solid boxes** (a black box, a blue box) over the map — *no documented competitor uses an elevated/material dark surface.* Our `--tm-dark-*` ramp + `.tm-glass` already beat that — once actually applied to Eagle Eye instead of inline hex.
- **The loud "cheap tells" are foundation failures:** tiny fonts that die in sunlight / for older eyes, reversed info ordering, jank/refresh-churn, bare progress bars, ads. Every one is something a disciplined foundation pass *prevents*.
- **The one competitor with a published design system froze it at ~2021 Material swatches.** A living, token-driven system is itself a differentiator.

So Phase 0 is not "table stakes polish" — for this category it is **a genuine moat we can occupy cheaply and defend.** That reframes the work: this is not "tidy the tokens," it is "lock the visual-quality lead while the lane is open."

---

## 2. Goals & non-goals

**Goals (this phase):**
1. Keep the system SF Pro font (decided, §6); the "instrument" feel comes from size/weight/tabular discipline + depth/motion/grain, not a typeface.
2. Tabular numerals verified on **every** live number (distance, score, handicap, timer, money) — no reflow, ever.
3. The dark-elevation ramp **applied** to Eagle Eye + every dark surface (kill bespoke inline hex), so depth reads as layered surfaces, not flat boxes.
4. Layered/hue-tinted shadows applied to light cards/modals (one consistent light direction).
5. Palette tells fixed: no pure `#000`/`#FFF` text on dark; accents desaturated for dark; AA verified **at the lightest elevation each color reaches**.
6. Motion discipline: animate only `transform`/`opacity`; one easing/duration vocabulary; `prefers-reduced-motion` honored as a hard rule.
7. A static grain overlay on dark surfaces to kill gradient banding.

**Non-goals (explicitly out of scope, tracked elsewhere):**
- MapLibre / Eagle Eye hero engine work (done — Phase 2).
- New accuracy features (graded GPS chip, dispersion bands) — that's the *next* slice, not foundation.
- The Eagle Eye 190+ inline-style → component refactor is **partially pulled forward** only where it's the mechanism for applying the elevation tokens; a full `<Sheet>`/HUD component extraction stays Phase 4.3.
- Skeletons everywhere (Phase 4.1) — Phase 0 ships the *shimmer primitive correctly*; full rollout is Phase 4.

---

## 3. Work packages — each independently shippable, build+lint-gated, device-verifiable

**Scope at a glance (Phase 0 is the app-wide foundation pass; dark-specific WPs concentrate on Eagle Eye because the app's main theme is the light "Augusta daylight" palette and Eagle Eye is essentially the only dark surface today):**

| WP | Scope |
|---|---|
| 0.A tabular numerals | **App-wide** — every live number, every screen |
| 0.C dark-elevation ramp | **Dark surfaces** → mostly Eagle Eye today (+ Practice, any dark HUD); becomes the standard for any future dark screen |
| 0.D layered shadows + palette hygiene | **App-wide** — light cards everywhere; global no-pure-`#000`/`#FFF` + desaturate-accents sweep |
| 0.E motion discipline | **App-wide** — every animation/transition + global `prefers-reduced-motion` |
| 0.F grain overlay | **Dark surfaces** → mostly Eagle Eye today (banding only shows on dark gradients) |


Ordered by perceived-quality-per-hour and by risk (safest first). Every WP ends in a verification gate; nothing merges unproven (beta discipline: `npm --prefix client run build` + `run lint` + `node --check` changed server files + `npm test`, then push to `main`, then device-check).

### WP-0.A — Tabular numerals: verify & close gaps (lowest risk, likely mostly-done)
- **What:** Audit every live-number surface (distance, F/C/B, plays-like, scores, to-par, handicap/index, money, timers, pace) and confirm tabular figures actually render. The `body`-level rule covers inherited text, but any element overriding `font-feature-settings` or using a non-tnum font silently loses it. Add `.tm-nums` (or the instrument class) explicitly on hero readouts.
- **Why it beats them:** no competitor documents this; jitter-free numbers are an instantly-visible polish win.
- **Verify:** screen-record a counting distance + a score going 9→10 → no horizontal shift; visual diff across tabs.
- **Risk:** near-zero. The only trap is a custom font (WP-0.B) lacking `tnum` → silent no-op; covered by the font choice.

### WP-0.B — ~~Type identity + instrument numerals~~ — DROPPED (font decision, §6)
- **Decision:** keep the system SF Pro font; no custom/bundled face. This WP is removed. Its scope (locking tabular figures on hero readouts; trying SF Pro's slashed-zero stylistic alternate **if it exists — verify, don't assume**) folds into WP-0.A. Net effect: the largest WKWebView risk (font loading) is off the board.

### WP-0.C — RE-SCOPED 2026-06-30 after code audit: the visible work is already done
- **Audit finding (verified):** Eagle Eye's dark surfaces are **already premium** — the main HUD, controls, sheets and plays-like panel are frosted glass (`backdropFilter: blur(22-28px) saturate(160%)`, inset top-rim highlight, layered shadow — e.g. `EagleEye.jsx:961,1772,1942,2030,2164,2237,2270`) or rich dark-green gradients (`linear-gradient(180deg,#0E1F13,#070C09)` at L2383). The 2026-06-23 premium pass did this via inline styles. **There are no flat opaque dark "boxes" left for the elevation ramp to improve**, so the documented competitor gap ("flat HUD boxes") is *already closed* on our showcase.
- **Therefore:** migrating the 265 inline color literals to `--tm-dark-*` tokens would be a **pure maintainability refactor with zero visible premium gain, on the brittle showcase screen** → that is Phase 4.3 (inline-style → component refactor), NOT Phase 0, and a drive-by refactor we explicitly avoid here (anti-pattern #20: don't re-architect what's already built+tested).
- **What stays in Phase 0:** the only genuinely-in-scope Eagle Eye items are (a) **palette tells** — pure `#fff` text on dark (e.g. F/C/B numerals at `EagleEye.jsx:1978/1981`) → off-white `--tm-dark-text` — folded into **WP-0.D**; (b) **grain** on the dark gradients — **WP-0.F**.
- **Ramp tokens:** the existing `--tm-dark-0..3` are already a sensible green-tinted ascending ramp (Δ≈+8-10/step, tint preserved); the research's computed hexes were *less* green-tinted and flagged unverified — so **keep ours, don't swap in the research values**. No recompute needed.
- **Net: WP-0.C requires no standalone code change.** Its real residue lives in D (palette) + F (grain).

### WP-0.D — Layered shadows + palette tells (light surfaces + color hygiene)
- **What:** Apply `--tm-shadow-layered` (and a hue-tinted `--shadow-sm/md/lg` set, green-tinted toward brand) to light cards/modals — one light direction, offset↑/blur↑/opacity↓ as elevation rises. Sweep components for pure `#000`/`#FFF` **text** and replace with `--tm-text` / `--tm-dark-text` (off-white). Desaturate accents used on dark.
- **Why it beats them:** single grey blurs read "square and clumsy"; layered tinted shadows read real/expensive.
- **Verify:** **never animate a layered shadow** (animate opacity of a shadow-bearing layer instead); contrast pass.
- **Risk:** low. Watch: don't let `box-shadow` end up in any transition.

### WP-0.E — Motion discipline pass
- **What:** One vocabulary: `--ease-standard` (0.4,0,0.2,1) for moves, decelerate for enters, accelerate for exits; durations 195–300ms band. Sweep for animations touching layout/paint props (`width`,`top`,`left`,`box-shadow`,`background-position`) → convert to `transform`/`opacity`. Add the global `prefers-reduced-motion` block (reduce/replace, not blanket-kill where a dissolve is better). `will-change` only surgically (add-before/remove-after), never blanket or on lists (real iOS crash vector ~50MB/layer).
- **Verify:** DevTools paint-flashing / "animated property" check shows compositor-only; 60fps on a mid device; Reduce-Motion on iOS stops fly-to + rolls.
- **Risk:** low–medium. Trap: an existing keyframe animating a layout prop that we miss. Mitigate: grep keyframes + `transition:` declarations.

### WP-0.F — Static grain overlay (kill banding)
- **What:** A fixed, `pointer-events:none`, ~6% opacity `fractalNoise` SVG data-URI overlay over dark surfaces, `numOctaves ≤ 3`, `stitchTiles="stitch"`, `isolation:isolate`, `mix-blend-mode: soft-light`. **Static only — never animate the filter** (animated feTurbulence is sluggish on iOS). Consider pre-rasterizing to a tiny tiled PNG to avoid even the one-time filter cost.
- **WKWebView landmine:** `mix-blend-mode` + `filter` on the *same* node is fragile on iOS 26.x — keep noise static and don't stack the two on one element; **test on-device.**
- **Verify:** near-black gradients lose visible banding; no measurable scroll/fps cost; taps pass through.
- **Risk:** low, but device-test the blend mode (WebKit vs Blink differ).

---

## 4. Risk register — what could go wrong, and the mitigation built in

Sorted by impact on our three pillars (usability / accuracy / visual flow) and on App-Store readiness.

| # | Risk | L | I | Mitigation (build in from the start) |
|---|---|:--:|:--:|---|
| 1 | ~~Custom font FOUT on cold launch~~ | — | — | **RETIRED** — no custom font (§6). System SF Pro has no loading step. |
| 2 | ~~Custom font lacks `tnum`~~ | — | — | **RETIRED** — SF Pro ships tabular figures; tabular numerals already on app-wide. |
| 3 | **Touching Eagle Eye's 190+ inline styles breaks layout** | M | H | Color-only edits, no layout changes; screenshot-diff each surface; targeted edits not a refactor; keep the full component extraction for Phase 4.3. |
| 4 | **Contrast fails on raised dark surfaces** — text that passes AA on `#0A0E0C` can fail on the lightened card | M | H | Test contrast **at the lightest elevation each color reaches**, not the base (Material rule). Bump hero readout toward AAA (7:1). |
| 5 | **Older-eyes / sunlight legibility** — blue (birdie) is the *weakest* discriminable hue for aging eyes in glare | M | H | Never encode meaning by hue alone; back score colors with luminance + shape/label. Keep readouts ≥20–28px, AAA. (Our eagle=gold/birdie=blue/par=muted order already fixes the documented "bad-score-looks-happier" tell — lock it, enforce everywhere.) |
| 6 | **`backdrop-filter` blur jank** on the glass HUD over a full-screen map on older iPhones | M | M | Keep blur radius modest; **never animate it**; don't span the scrolling surface; ship `-webkit-backdrop-filter`; solid fallback already in `.tm-glass`. |
| 7 | **`will-change` / layer overuse → iOS memory crash** over a long round (no catchable OOM) | L | H | Surgical promotion only (add-before/remove-after); never blanket or on lists; one map instance. |
| 8 | **Grain overlay perf / blend bug on iOS 26.x** | L | M | Static filter (or pre-rasterized tile); don't stack `filter`+`mix-blend-mode` on one node; `isolation:isolate`; device-test. |
| 9 | **Animating a layout/paint prop we missed** → jank | M | M | Grep all `@keyframes` + `transition:` for layout/paint props; DevTools paint-flash audit. |
| 10 | **Regressing a working screen** (this ships to beta `main` = Matt's test surface) | M | H | Each WP independently build+lint+`node --check`+`npm test` gated; push small; device-check; never hold build-verified work on a branch (anti-pattern #22) but never push broken (#23). |
| 11 | **`100vh`/keyboard/safe-area layout shifts** from any viewport-touching change | L | M | Use `100svh`; `max(env(...), fallback)` for insets; the keyboard-inset hazard via `visualViewport`; full-bleed stays deferred to the native shell (POST-LAUNCH #24) — **no PWA viewport changes** in this phase. |
| 12 | **Framing drift** — calling a shortcut "fine for now / MVP" | L | M | Anti-pattern #26 checkpoint: build the higher bar; name shortcuts as shortcuts. |

**The two that most decide the outcome:** #2/#4/#5 (a font swap or elevation change that *silently degrades* legibility — the opposite of the goal) and #3/#10 (breaking a live screen on the beta). Both are handled by *verify-on-device-before-claim* and small, gated, reversible commits.

---

## 5. Sequencing

```
WP-0.A  tabular verify        (do first — cheap confidence; absorbs the old WP-0.B numeral scope)
WP-0.B  DROPPED               (font decision, §6)
WP-0.C  dark-elevation apply  ─┐
WP-0.D  layered shadows + palette │ independent, ship in any order
WP-0.E  motion discipline         │
WP-0.F  grain overlay  (last — purely additive) ─┘
```
A is a free confidence check. C/D/E are independent and can ship in any order. F is purely additive, ship last. Each is its own commit to `main` with its own device-check.

---

## 6. Font strategy — DECIDED (Matt, 2026-06-30): keep the system font

**Decision: no font change. Keep the system SF Pro stack we ship today.** Matt reviewed a 4-up mockup (Current vs A/B/C, rendered on the real dark palette) and chose to keep the current font — judging a custom-font swap a "reach." This is well-supported, not a compromise:
- The competitor research's own recommendation #12 is *"default to SF Pro; reserve any custom face for a single brand/display role only."* Apple HIG recommends the system font unless branding demands otherwise.
- SF Pro is free, ships excellent tabular figures, gives Dynamic Type + optical sizing + accessibility a reviewer can verify, and has **zero loading risk** in WKWebView.

**Consequence — the plan gets leaner and safer:** WP-0.B (type identity / bundled instrument font) is **dropped**. Its risks (#1 FOUT, #2 font lacking `tnum`) come off the board entirely. The "instrument" premium feel is now delivered by **size + weight + tabular-numeral discipline + slashed-zero IF SF Pro supports it (verify, don't assume) + the elevation/motion/grain work** — not a typeface. Any explicit numeral styling on hero readouts folds into WP-0.A.

---

## 7. Verification & audit plan (built into every WP)

- **Per-commit gate:** `npm --prefix client run build` + `run lint` (the `no-undef` hard gate that caught a real scope bug this arc) + `node --check` on any changed server file + `npm test`.
- **Visual:** screenshot/diff each touched surface before/after; a counting-number recording for tabular; DevTools paint-flash for motion.
- **Contrast:** every color checked at the *lightest elevation it reaches* (not the base); readouts targeted at AAA.
- **Device:** Matt verifies on the iPhone via the beta `main` (the native-shell behaviors — fonts offline, blur perf, grain blend, Reduce-Motion — only fully prove out on-device).
- **Design critique:** run the `design:design-critique` + `design:accessibility-review` skills on the rendered Eagle Eye + a light screen after WP-0.C/D.
- **audit-before-claim** before declaring any WP done — no "it works" without a cited artifact (screenshot/diff/test output).

---

## 8. Progress checklist

> Legend: ☐ not started · ◐ in progress · ☑ done · ⊘ deferred (out of phase)

**Pre-work**
- ☑ Roll Call (WARN: 4 known yellows — Pinecone quota, sync lag; 0 red)
- ☑ Ground-truth audit — corrected the "NONE done" claim (§0)
- ☑ Competitor + foundation research (two cited reports)
- ☑ **Matt's font decision (§6)** — KEEP system SF Pro; WP-0.B dropped
- ☐ Matt's go-ahead on the spec to start editing code on beta `main`

**WP-0.A — Tabular numerals: verify & close gaps**
- ☐ Inventory every live-number surface (distance, F/C/B, plays-like, scores, to-par, index, money, timers, pace)
- ☐ Confirm tnum renders on each; add explicit class on hero readouts
- ☐ Verify: counting-number recording shows no reflow

**WP-0.B — DROPPED** (keep system SF Pro, §6). Numeral-styling scope folded into WP-0.A.

**WP-0.C — RE-SCOPED (audit): no standalone change**
- ☑ Audit: Eagle Eye dark surfaces already glass/gradient-premium; no flat boxes to ramp
- ☑ Decision: keep existing `--tm-dark-*` ramp (green-tinted, good); don't swap research hexes
- ☑ Residue folded into WP-0.D (pure-`#fff` palette tells) + WP-0.F (grain). Full inline→token refactor = Phase 4.3.

**WP-0.D — Layered shadows + palette tells**
- ☐ Apply layered/hue-tinted shadows to light cards/modals (one light direction)
- ☐ Sweep + fix pure `#000`/`#FFF` text; desaturate dark-mode accents
- ☐ Verify: no shadow in any transition; AA at lightest elevation

**WP-0.E — Motion discipline**
- ☐ One easing/duration vocabulary applied; convert layout/paint animations → transform/opacity
- ☐ Global `prefers-reduced-motion` block (reduce/replace)
- ☐ `will-change` audit (surgical only)
- ☐ Verify: compositor-only (paint-flash), 60fps, Reduce-Motion stops motion

**WP-0.F — Static grain overlay**
- ☐ Add static fractalNoise overlay (≤3 octaves, isolate, soft-light) or pre-rasterized tile
- ☐ Verify: banding gone, no fps cost, taps pass through, blend OK on-device

**Close-out (CLAUDE.md end-of-session)**
- ☐ Correct the stale "Phase 0: NONE done" lines in the handoff + premium plan + flip build-plan checklist boxes
- ☐ `wiki/log.md` entry · commit + push the-match repo
- ☐ NotebookLM refresh if wiki/CLAUDE.md changed (verify_failed:0)
- ☐ Preflight green except known yellows

---

## 9. Sources

- Competitor research: `golf-app-foundation-ux-research.md` (this session; per-claim URLs inside).
- Foundation best practices: `the-match-foundation-research.md` (this session; MDN, Material, web.dev, WCAG/W3C, NN/g, Apple HIG, Comeau, Ahlin, caniuse, font foundry/OFL pages, WKWebView gotchas).
- Codebase ground-truth: `client/src/design/tokens.css`, grep of `client/src` (this session).
- Project plans: `eagle-eye-premium-plan-2026-06-23.md`, `build-plan-bulletproof-2026-06-23.md`, `next-session-handoff-2026-06-29.md`.
