---
type: synthesis
created: 2026-07-02
updated: 2026-07-02
tags: [the-match, eagle-eye, design-tokens, phase-4-3, refactor, build-plan]
---

# Phase 4.3 — Eagle Eye Inline-Style → Token Refactor (Bulletproof Build Plan)

Master build plan for converting `client/src/pages/EagleEye.jsx` from ad-hoc inline
style literals to a governed design-token system. Companion to
`build-plan-bulletproof-2026-06-23.md` (Phase 4.3) and
`eagle-eye-premium-plan-2026-06-23.md` (Phase 3 app-wide premium polish).

> **North Star (Matt, 2026-07-02):** best golf app in the world — usability, accuracy,
> visual flow. This refactor is a *foundation* move: it makes the hero screen consistent,
> maintainable, and ready to be elevated. It is not cosmetic busywork; it removes the
> single largest source of silent visual drift on the most important screen in the app.

---

## 1. Why this matters (the problem, measured)

Verified this session against the live file (`EagleEye.jsx`, `tokens.css`):

- **2,544 lines · 237 inline `style={{}}` blocks · only 11 `var(--tm-*)` references.**
  The hero screen is ~99% hardcoded literals.
- **~30 distinct color bases, ~130 color literal uses**, plus large opacity families:
  **29 distinct `rgba(255,255,255,*)` opacities alone**, ~40 gold-tint rgba, ~35 green
  rgba, ~30 dark-bg rgba.
- The app's design tokens **moved to a light parchment theme** (`--tm-bg` = `#F2EEE6`).
  Eagle Eye is a **dark instrument screen** (`#070C09` bg, `#F5D78A` light-gold readouts,
  `#5ED47A` alignment green). **The existing `--tm-*` palette does not cover it.**

**Consequence:** every color on the hero screen is a raw literal that can drift from the
rest of the app with nobody noticing — exactly the failure class this project keeps
getting bitten by. Tokenizing it is how we make "consistent + on-palette" a guarantee
instead of a hope.

### The traps (why this is NOT a find-and-replace)

1. **`#070C09` ≠ `--tm-dark-0` (`#0A0E0C`).** Verified. A naive "swap to nearest token"
   would shift the background on OLED. 6 direct uses + ~30 `rgba(7,12,9,*)`.
2. **Only 3 colors map to an existing token exactly:** `#C9A040`→`--tm-gold`,
   `#E8C05A`→`--tm-gold-bright`, `#2A7A38`→`--tm-green-bright`. Everything else has **no
   token** or is a **trap**.
3. **Conditional/ternary colors** (verified lines): 333 (`accent='#5ED47A'` default prop),
   495, 505, 660, 799, 1753 (triple ternary), 2068. These carry *logic* — each branch must
   be handled, they cannot be blindly substituted.
4. **SVG `fill`/`stroke` attributes** (not CSS) at 267–275, 346–348, 551–561, 590–598,
   915–921 — different substitution mechanics than CSS `style`.
5. **No type scale, no spacing scale, no letter-spacing scale exist in `tokens.css`.**
   Radius/shadow/duration are only partially covered. Creating those scales is a *design
   decision*, not a mechanical swap.

---

## 2. Competitive research — what "better" looks like (informs token *values*, staged for later)

Full report in session log. Verified highlights that shape our design direction:

- **The dark-instrument metaphor is an unclaimed lane on phones.** Only Arccos (charcoal)
  and Garmin AMOLED watches go truly dark; the phone leaders (18Birdies, Golf Pad) are
  bright satellite maps criticized as "vanilla" and hard to read in sun. Eagle Eye's dark
  screen is a *strategic differentiator* — the token system should protect and sharpen it.
- **Emerging cross-industry color code: white = raw distance, green = plays-like/adjusted**
  (appears on *both* Arccos app and Bushnell hardware). Our tokens should encode this
  semantic (a `--tm-ee-raw` / `--tm-ee-adjusted` pairing) so the meaning is named, not
  incidental.
- **Big-number hero** (Garmin "Big Numbers", Golfshot auto-enlarge, readable without
  glasses) is the category convention. Our type scale (when built) should make the primary
  yardage dominant.
- **Hard DON'T (unanimous):** never show a ± margin / confidence band on the hero number.
  No mainstream app or device does. It reads as false precision and kills commitment. Our
  standing marketing/accuracy rule already forbids this — the token work must not sneak in
  a "confidence chip." (Matches `build-plan-bulletproof` operational decision, Matt.)
- Other documented competitor mistakes to *not* reproduce: 18Birdies' backwards F/C/B
  ordering; GolfLogix's forced irreversible view switch; finger-occlusion of the aim number.

**Scoping decision:** value *elevation* toward best-in-class (white=raw/green=adjusted
semantics, big-number hierarchy) is **Stage C**, a separate reviewed pass. Stages A–B
freeze today's exact values so the refactor is provably pixel-identical first. We reach the
"full" destination Matt chose, but staged behind verification gates so each step is safe.

---

## 3. Token architecture (the design)

### 3.1 Namespace: Eagle Eye owns its palette — `--tm-ee-*`

Eagle Eye gets a **dedicated instrument-palette namespace** rather than reusing the app's
`--tm-*` tokens, even for the 3 that currently match. Rationale:

- The app theme went **light**; the instrument is **dark**. They are different surfaces
  with different intent. Coupling them is what *created* this drift risk.
- If a future app-theme change shifts `--tm-gold`, the instrument must **not** silently
  move with it. EE-owned tokens make the boundary explicit.
- Self-contained = safe to reason about the hero screen in isolation.

Defined in a clearly-commented block in `tokens.css` (single source of truth), values
**exactly equal to today's literals**.

### 3.2 Solid-color tokens (exact current values)

```css
/* ---- Eagle Eye instrument palette (dark surface, self-contained) ---- */
--tm-ee-bg:          #070C09;  /* instrument background (NOT --tm-dark-0) */
--tm-ee-ink:         #0A0A0A;  /* near-black SVG stroke (WindDial) */
--tm-ee-gold:        #C9A040;  /* primary gold (== --tm-gold today, owned by EE) */
--tm-ee-gold-bright: #E8C05A;  /* gradient/pulse endpoint (== --tm-gold-bright today) */
--tm-ee-gold-light:  #F5D78A;  /* readout / chip-label light gold (34 uses) */
--tm-ee-green:       #5ED47A;  /* alignment / GPS-locked / "shorter" (14 uses) */
--tm-ee-green-deep:  #2A7A38;  /* gradient deep green (== --tm-green-bright today) */
--tm-ee-amber:       #F0A868;  /* acquiring / "plays longer" warm (7 uses) */
--tm-ee-red:         #F87171;  /* adjustment penalty / "plays longer" (1 use) */
```

### 3.3 Opacity families: RGB-triplet tokens + `rgb(... / a)` syntax

The opacity explosion (29 white opacities, ~40 gold-tint, ~35 green, ~30 dark) makes
one-token-per-opacity untenable. Instead, define **one RGB-triplet token per color** and use
modern space-separated `rgb()` with slash-alpha at the call site — this preserves the
**exact** value while collapsing ~140 rgba literals to 9 tokens.

```css
--tm-ee-bg-rgb:          7 12 9;
--tm-ee-gold-rgb:        201 160 64;
--tm-ee-gold-bright-rgb: 232 192 90;
--tm-ee-gold-light-rgb:  245 215 138;
--tm-ee-green-rgb:       94 212 122;
--tm-ee-green-deep-rgb:  42 122 56;
--tm-ee-amber-rgb:       240 168 104;
--tm-ee-white-rgb:       255 255 255;
--tm-ee-black-rgb:       0 0 0;
```

Call site: `rgba(255,255,255,0.25)` → `rgb(var(--tm-ee-white-rgb) / 0.25)`.

**Runtime safety:** `rgb(R G B / a)` slash-alpha syntax (CSS Color 4) is, per known WebKit
support history, available since Safari 12.1 / iOS 12.2 — comfortably below the iOS 15+ App
Store target. **This has NOT been re-verified against a live compatibility source this
session** — treat it as high-confidence-but-unconfirmed and make the on-device smoke-test in
the Stage-B gate a hard requirement, not a formality. If it fails on the shell, fall back to
named per-opacity tokens for the values actually used.

### 3.4 Semantic aliases (named meaning, points at palette)

```css
--tm-ee-raw:      var(--tm-ee-gold-light);  /* raw GPS distance readout */
--tm-ee-adjusted: var(--tm-ee-green);       /* plays-like / adjusted (white→green convention) */
--tm-ee-aligned:  var(--tm-ee-green);       /* reticle alignment success */
--tm-ee-acquiring:var(--tm-ee-amber);       /* GPS acquiring */
```

These make the *intent* legible and set up Stage C (elevate values behind a stable name)
without a second literal-hunt.

### 3.5 Deferred to their own tickets (NOT Stage A/B — these are new scales = design work)

- **Type scale** (15 font sizes), **spacing scale** (20+ values), **letter-spacing scale**
  (12 values). Creating these means *choosing* a scale (e.g., 4px grid, modular type ramp),
  which can change values → not pixel-identical → belongs in a reviewed design-system task.
- **Radius/shadow/duration:** only swap the ones that match an existing token **exactly**
  (radius 6/12/9999, shadow-lg `0 8px 32px`); leave the rest until the scale question is
  settled.

---

## 4. Staged build plan (each stage independently shippable + verifiable)

### Stage A — Establish tokens (no behavior change)
- **A1.** Add the `--tm-ee-*` block (§3.2–3.4) to `tokens.css` with exact values. No JSX
  touched yet. → verify: `npm --prefix client run build` clean; visual diff = zero (nothing
  references them).
- **A2.** Add a short comment header in `tokens.css` documenting the EE namespace + the
  white=raw/green=adjusted intent + "values frozen to 2026-07-02 literals."

### Stage B — Swap literals → tokens, region by region (pixel-identical)
Swap in **small, independently-verifiable commits by file region** (from the inventory map),
easiest/safest first. After each region: lint + build + geo.test + vitest + screenshot diff.

- **B1.** Static solid colors (non-conditional, non-SVG): the bulk of `#F5D78A / #5ED47A /
  #C9A040 / #E8C05A / #F0A868 / #070C09` in plain `style={{ color/background/border }}`.
- **B2.** Opacity families → `rgb(var(--tm-ee-*-rgb) / a)` (whites, gold-tint, green, dark-bg).
- **B3.** Conditional/ternary colors (lines 333, 495, 505, 660, 799, 1753, 2068). Keep the
  ternary *logic* byte-for-byte; only the color operands become tokens. One commit, careful
  review, each branch checked.
- **B4.** SVG `fill`/`stroke` attributes (267–275, 346–348, 551–561, 590–598, 915–921).
  `stroke="rgb(var(--tm-ee-*-rgb) / a)"` works in SVG presentation attributes; verify each
  renders identically. The `accent` prop default (333) becomes `accent = 'var(--tm-ee-green)'`.
- **B5.** box-shadow / drop-shadow / inset-highlight strings that use EE colors (357, 584,
  1911, 2007, 2379) → token-based `rgb(... / a)` inside the shadow string.
- **B6.** Exact-match non-color tokens only: radius 6/12/9999 → `--tm-radius-sm/--tm-radius/
  --tm-radius-full`; shadow `0 8px 32px` → `--tm-shadow-lg`. Skip anything not an exact match.

### Stage C — Visual elevation (SEPARATE, reviewed, optional; only after A+B verified)
- Using competitor research: consider elevating specific *values* behind the now-stable
  token names (big-number type ramp, sharpen white=raw/green=adjusted). Each change is a
  deliberate design decision reviewed with Matt + verified on device. **Not part of the
  pixel-identical guarantee.** Type/spacing/letter-spacing scale creation lives here or in
  its own design-system ticket.

---

## 5. Verification gates (every stage, non-negotiable)

Per `CLAUDE.md` beta discipline — a clean `vite build` is NOT sufficient (it compiles
undefined identifiers that then ReferenceError on device):

```
npm --prefix client run lint      # ESLint no-undef — catches server-only leaks / typos
npm --prefix client run build     # must be clean
node client/src/lib/geo.test.mjs  # 31/31 — geometry untouched, proves no collateral damage
npm test                          # vitest suite green
```
Plus, because this is a *visual* refactor with a pixel-identical claim:
- **Screenshot diff** of Eagle Eye (welcome, distance view, plays-like sheet, camera modal,
  course picker, bag sheet) before vs after each region — must be visually identical.
- **On-device pass** on the native iOS shell before Stage B is called done (POST-LAUNCH #25
  covers the on-course confirmation; the visual pixel-check can be done in the beta first).

Only after all gates pass: commit + push to `main` (beta = `main`).

---

## 6. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | Naive swap `#070C09`→`--tm-dark-0` shifts bg color | High if careless | Visible on OLED | Dedicated `--tm-ee-bg` = exact `#070C09`; never point at `--tm-dark-0` |
| R2 | Ternary color operand mishandled → wrong branch color | Med | Broken alignment/GPS feedback | B3 isolated commit; verify each branch renders; keep logic byte-identical |
| R3 | `rgb(... / a)` slash-alpha unsupported in runtime | Low | Colors fail to render | Target iOS 15+ guarantees support; smoke-test on device in B2 gate |
| R4 | Undefined `var()` typo compiles but renders wrong | Med | Silent visual break | Lint + screenshot diff per region; small commits localize blast radius |
| R5 | SVG presentation attr doesn't accept `var()`/`rgb()` as written | Med | Icon renders wrong | B4 verifies each SVG individually; fall back to inline `style` on the SVG node if attr rejects it |
| R6 | Scope creep into type/spacing "while we're here" | Med | Pixel drift, blown guarantee | Hard rule: A/B are exact-value only; scales are Stage C / separate ticket |
| R7 | Drive-by refactor of adjacent logic | Low | Violates code discipline | Every changed line traces to token swap; no logic edits (CLAUDE.md) |
| R8 | Big diff hard to review/rollback | Med | Hard to bisect a regression | Region-by-region commits; each independently revertable |
| R9 | Touching HoleMapGL distance code | Low | Breaks verified-accurate distances | Out of scope — do not touch; geo.test guards it |

**Rollback:** each region is its own commit; revert the offending commit. Stage A alone is
inert (defining unused tokens changes nothing) so it can sit safely even if B is paused.

---

## 7. Progress checklist

**Planning**
- [x] Research competitor yardage/instrument screens (agent) — 2026-07-02
- [x] Full inventory of EagleEye.jsx literals + token gaps (agent, spot-checked) — 2026-07-02
- [x] Design `--tm-ee-*` token architecture — 2026-07-02
- [x] Write this bulletproof plan + checklist — 2026-07-02
- [ ] Audit plan with `audit-before-claim`
- [ ] Matt greenlights Stage A build

**Stage A — establish tokens**
- [ ] A1 add `--tm-ee-*` solid + rgb-triplet + semantic tokens to `tokens.css` (exact values)
- [ ] A2 comment header documenting namespace + white=raw/green=adjusted intent
- [ ] Gate: build clean, zero visual change

**Stage B — swap literals (region by region, gated each)**
- [ ] B1 static solid colors
- [ ] B2 opacity families → `rgb(var(--tm-ee-*-rgb) / a)`
- [ ] B3 conditional/ternary colors (333, 495, 505, 660, 799, 1753, 2068)
- [ ] B4 SVG fill/stroke attrs (267–275, 346–348, 551–561, 590–598, 915–921) + accent prop
- [ ] B5 box-shadow/drop-shadow/inset strings (357, 584, 1911, 2007, 2379)
- [ ] B6 exact-match radius/shadow non-color tokens only
- [ ] Gate each region: lint + build + geo.test 31/31 + vitest + screenshot diff
- [ ] On-device pixel-identical pass (beta), then push to `main`

**Stage C — visual elevation (separate, optional, reviewed)**
- [ ] Type/spacing/letter-spacing scale as a design-system decision
- [ ] Elevate values behind stable token names (big-number hero, white=raw/green=adjusted)
- [ ] Per-change review with Matt + on-device verification

---

## 8. Scope guardrails (what this plan will NOT do)

- Will **not** touch `HoleMapGL.jsx` distance logic or the `teeOffset` band-aid (load-bearing,
  verified accurate — handoff 2026-07-02).
- Will **not** change any visual value in Stage A/B — pixel-identical is the contract.
- Will **not** add a confidence/±-margin chip (standing marketing/accuracy rule).
- Will **not** create type/spacing scales inside the mechanical refactor.
- Will **not** drive-by refactor adjacent logic — every changed line traces to a token swap.

---

## Sources
- Live file reads this session: `client/src/pages/EagleEye.jsx`, `client/src/design/tokens.css`
  (line-level claims spot-checked via grep/sed).
- Competitor research agent report (session log, 2026-07-02) — 18Birdies, Golfshot, Arccos,
  Hole19, SwingU, GolfLogix, TheGrint, Golf Pad, Garmin; Bushnell/Garmin hardware aesthetic.
- `wiki/synthesis/next-session-handoff-2026-07-02.md` (Eagle Eye state, do-not-touch list).
- `wiki/synthesis/build-plan-bulletproof-2026-06-23.md` (Phase 4.3 parent), `CLAUDE.md`
  (beta discipline, App-Store bar, framing check).
