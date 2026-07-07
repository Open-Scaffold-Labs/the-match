---
type: synthesis
created: 2026-07-07
updated: 2026-07-07
tags: [eagle-eye, design-tokens, maplibre, phase-4-3, build-spec]
---

# EE Stage C + HoleMapGL tokenization — bulletproof build spec (2026-07-07)

Parent: [[synthesis/eagle-eye-tokenization-plan-2026-07-02]] (Stage A+B shipped `f39eea4..7add76f`).
Greenlit by Matt 2026-07-07 ("greenlight… lock in") with the standing bar: usability, accuracy,
visual flow — do it better than the most-used golf apps, not just match them.

## 1. What this ships

Two slices, deliberately different contracts:

- **Slice 1 — HoleMapGL token conversion (pixel-identical, mechanical).** All ~44 color-literal
  lines in `client/src/pages/HoleMapGL.jsx` move behind `--tm-ee-*` tokens: MapLibre paint props
  via the `eeColor` bridge (resolved-at-creation, literal fallbacks), DOM/JSX/`<style>` via
  `var()` / `rgb(var()/a)`. Zero visual change is the contract, verified per line.
- **Slice 2 — Stage C visual elevation (reviewed design deltas).** Research-grounded value
  changes behind the now-stable token names. Each delta is presented to Matt with before/after
  values and shipped only on approval (per the Stage C contract in the parent plan).

## 2. Research foundation (2 agents, 2026-07-07, cited in session log)

**Competitive/UX** (10 most-used golf GPS apps + rangefinder hardware surveyed):
- Documented color precedent (the only one in the category, current as of Feb 2025): **white =
  raw GPS, green = weather-adjusted** (Arccos). Garmin codes plays-like with icons (▲▪▼), not
  color. **No leader uses gold for a distance value** — gold is unclaimed; we can own it as the
  "locked/aligned" state. No leader color-codes GPS-acquiring; instrument-panel convention
  (aviation/automotive) is that unverified data never displays in a confidence color.
- Our hero type (46/900 gauge, 52/900 sheet, 68/800 result, tabular) is **at/above the category
  bar**. Cited gaps: 9px micro-labels are below every outdoor-legibility guideline surveyed
  (Apple 11pt floor; sunlight research wants ≥5:1 effective contrast + bolder/bigger);
  category leader ships a named **"Big Numbers" mode** we lack (logged as follow-up, not this slice).
- Map labels: bare haloed numbers (no pill) is the correct approach per cartography canon
  (ESRI/Penn State); refinement is a **soft blurred dark casing ~40–60% opacity** rather than a
  hard stroke; oversized halos hurt. Category color language: white=target, blue=you,
  gold/yellow=pin, warm=hazard — our palette already complies.
- Leaders' weaknesses = our openings: admitted screen clutter (TheGrint's own copy), hierarchy
  regressions (18Birdies), mid-round upsells (Bushnell), binary numbers-vs-map modes (Garmin).
  Calm-by-default instrument screens are the winning posture.

**MapLibre engineering** (primary-source verified: maplibre-style-spec `parse_css_color.ts`,
`validate_color.ts`, `style.ts`, `style_layer.ts`):
- Spec ≥19 (gl-js v3/v4/v5) parses hex 3/4/6/8, comma `rgb()/rgba()`, space/slash CSS Color 4,
  `hsl()`, named colors. **`var()` never.** Comma-form `rgba(r,g,b,a)` is the safest interchange —
  exactly what `eeColor` emits.
- **Worst failure mode: an invalid color at `addLayer` silently drops the entire layer**
  (validation returns early, fires ErrorEvent → console.error, no exception). Literal fallbacks
  in the bridge are therefore load-bearing, not decoration.
- `['case', …]` expression branches parse the same formats; invalid literal = same layer-drop.
- `getComputedStyle` at map `load` is timing-safe (Vite awaits chunk CSS before JS; React mounts
  post-DOMContentLoaded; `load` fires later). WebKit may serialize leading whitespace on custom
  properties — `eeColor`'s `.trim()` is load-bearing. Always read `document.documentElement`,
  never the map container.
- `var()` in **SVG presentation attributes** inside marker `innerHTML` is the likeliest
  silent-wrong-color trap (attribute values don't do CSS substitution in the general case, and
  Stage B's TOKEN-CHECK-PASS verified JSX-rendered SVG in Blink, not innerHTML-injected markers
  in WebKit). Guard: use `style="fill:…"` declarations inside injected SVG — guaranteed CSS.
- In CSS with space-separated triplets, only `rgb(var(--x-rgb) / a)` is valid;
  `rgba(var(--x-rgb), a)` is a dropped declaration. (JS bridge output uses comma-form on
  resolved numbers, which is fine.)
- Latent `eeColor` defect: alpha path fed a solid (hex) token emits `rgba(#hex,a)` → invalid →
  fallback path saves rendering but masks the bug. Guard: hex-detect in the alpha branch +
  dev-only warn on empty token reads.
- Recommended shape: resolve all tokens **once per map init into a frozen object** (one
  computed-style read), each entry with its literal fallback.

## 3. Slice 1 — HoleMapGL conversion (build plan)

Inventory (44 literal lines, three categories):

- **M — MapLibre paint props** (must use bridge): base style `bg` `#0c1a10` + `tint` `#0E3B23`
  (264–266); fairway glow/line `#F5E070` (328–329); green fill/line `#5ED47A` (330–331); halo
  fill/line `#F5D78A` (332–333); landing fill/line `#F5E070` (362–363); `['case']` branches
  `#F5E070`/`#F5D78A`/`rgba(245,224,112,0.62)` (371, 377). Lines 341–355 already bridged.
- **D — DOM cssText / innerHTML** (CSS `var()` works): popup pill (139–142), `distEl` white
  number + halo (173–183), GPS dot (446), pin-flag marker SVG (454–455), target circle (469),
  green-center dot (726). SVG fills inside `innerHTML` move to `style=` declarations (research
  guard), never presentation attrs.
- **J — JSX inline styles + `<style>` template** (CSS `var()` works): fallback screen + CTA
  (772–781), popup/ctrl-group CSS (790–800), container bg (807).

Token gaps → 3 new tokens (append to the EE block in `tokens.css`, exact current values):
`--tm-ee-map-bg: #0c1a10` (map base under imagery) · `--tm-ee-map-tint: #0E3B23` (green tint
wash) · `--tm-ee-flag: #E53935` (pin-flag red, also the distEl flag glyph).

Bridge hardening (same commit, behavior-identical): resolve-once frozen object at map init;
`eeColor` alpha-path hex guard + dev-only `console.warn` on empty reads. Literal fallbacks stay
byte-identical to today's values on every call site.

Conventions carried from Stage B: bare `#fff`/`#000` literals stay (kept-by-design); every
`rgba(255,255,255,a)`/`rgba(0,0,0,a)` in CSS-land → `rgb(var(--tm-ee-white-rgb) / a)` /
`rgb(var(--tm-ee-black-rgb) / a)`; operands-only in ternaries/case-expressions, logic
byte-identical.

**Out of scope (hard lines):** distance math, `teeOffset`, layer structure/order, opacities,
widths, blurs, `distEl` sizes — nothing but color-value indirection. R9 from the parent plan
stands: `geo.test` guards geometry untouched.

## 4. Slice 2 — Stage C proposals (each requires Matt's approval before ship)

Grounded in §2; presented as before → after:

- **C1. Re-rule the semantic aliases** (tokens.css lines 140–143): `--tm-ee-raw` gold-light →
  **white**; `--tm-ee-aligned` green → **gold**; `--tm-ee-acquiring` amber → **dimmed white
  (60% opacity ramp)**; `--tm-ee-adjusted` stays **green**. Ruling: white = measured, green =
  computed, gold = locked/trusted, dim = not yet trustworthy. Then **wire the aliases** into the
  call sites that today reference palette tokens directly (hero surfaces first), so future
  design moves are one-line token edits.
  ⚠ Visible consequences to review: plays-like sheet hero `52px` flips gold-light → green
  (it's a computed number); gauge hero stays white (raw); GPS-locked accents flip green → gold;
  acquiring amber loses its color reward. This is the deliberate, research-backed re-ruling —
  the single highest-leverage visual-semantics change available.
- **C2. Micro-label floor 9px → 11px** on the gauge label + YDS unit (2 sites in EagleEye.jsx),
  tracking kept. Outdoor legibility floor; smallest possible diff.
- **C3. Map-label halo softening**: `distEl` swaps the hard 0.75px text-stroke for a slightly
  wider soft shadow casing at reduced opacity (tuned on device with Matt — imagery-dependent,
  not shippable blind).
- **C4 (logged follow-up, NOT this session): "Big Numbers" glance mode** — hero ≥68px, F/B as
  labels — as a build-plan item, closes the one structural gap vs the category leader.

## 5. Verification gates (every commit, non-negotiable)

```
npm --prefix client run lint          # no-undef + jsx-no-undef (af059f3 gate)
npm --prefix client run build         # clean
node client/src/lib/geo.test.mjs      # 31/31 — geometry untouched
npm test                              # node --test suite green
```
Plus, slice-specific:
- **Value-equivalence check (Slice 1)**: script resolves every token/bridge expression against
  `tokens.css` and diffs byte-for-byte vs the pre-edit literal per changed line — the Stage B
  244/244 technique. MapLibre-bound outputs additionally validated against the accepted-format
  regex (`^(#|rgb|hsl|[a-z])`).
- **Layer-presence check (Slice 1)**: because the failure mode is a *silently missing layer*,
  a browser walk of Eagle Eye's map view must confirm all converted layers render (fairway,
  green, halo, landing, hole-line, rings/arcs) — visible window per the 07-06 lesson.
- **Lockfile discipline**: no `npm install` is expected; if any dependency changes, lockfile
  diff + clean-slate install with Vercel's exact command (07-07 rule).
- Slice 2 ships only after Matt approves each delta; on-device eyeball is his call per C-item.

## 6. Risk register

| # | Risk | L | Impact | Mitigation |
|---|------|---|--------|-----------|
| R1 | Invalid color at addLayer → whole layer silently missing | Med | Map loses fairway/green/etc., no error surfaced to user | Literal fallbacks byte-identical to today; dev-format assertion; layer-presence browser walk |
| R2 | `var()` in injected SVG attrs ignored in WKWebView → wrong fill | Med | Flag/marker renders black/wrong | `style=` declarations only inside `innerHTML` SVG; browser-verified |
| R3 | Alpha path fed hex token → invalid rgba masked by fallback | Low | Token edit later silently no-ops | Hex guard + dev warn in `eeColor` |
| R4 | `rgba(var(--x-rgb), a)` written in CSS → declaration dropped | Med | Element loses color entirely | Slash-form only in CSS; grep gate for `rgba(var(` before commit |
| R5 | Ternary/case operand slip changes logic branch | Low | Wrong highlight color | Operands-only rule; value-equivalence diff catches |
| R6 | Scope creep into opacity/width/size "while we're here" | Med | Pixel drift, blown guarantee | Slice 1 is color-indirection only; C-deltas quarantined to Slice 2 |
| R7 | C1 re-ruling looks wrong on device despite being right on paper | Med | Hero loses premium feel | Ship C1 behind Matt's explicit approval; aliases make revert a 4-line change |
| R8 | Touching distance logic / teeOffset | Low | Breaks verified accuracy | Out of scope; geo.test 31/31 gate |
| R9 | Stale SW serves old bundle during browser walk → false failure | Med | Wasted debugging | Retry after reload per 07-06 rule; served-bundle gate (vercel inspect + content grep) |

Rollback: Slice 1 is one revertable commit (or two if M/D+J split aids bisection); C-deltas are
one commit each. Aliases mean C1's revert is `tokens.css`-only.

## 7. Progress checklist

**Planning**
- [x] Recon: live inventory of HoleMapGL literals, bridge, token gaps — 2026-07-07
- [x] Research agents: competitive UX + MapLibre engineering (cited) — 2026-07-07
- [x] This spec + risk register
- [ ] Audit spec + claims with audit-before-claim

**Slice 1 — HoleMapGL conversion (pixel-identical)**
- [x] S1a. 3 new tokens (`--tm-ee-flag/map-bg/map-tint`, exact values) + bridge hardening
      (module-level computed-style cache, alpha-path hex guard, dev warns) — 2026-07-07
- [x] S1b. M-category: paint props → bridge (fallbacks byte-identical, case-expression
      operands only) — 2026-07-07
- [x] S1c. D+J categories → var()/slash-form; injected-SVG colors moved to `style=`
      declarations (research guard R2) — 2026-07-07
- [x] Gate: lint ✓ build ✓ geo 31/31 ✓ npm test 83/83 ✓ value-equivalence 57/57 color
      occurrences byte-identical ✓ `rgba(var(` grep = 0 ✓ — 2026-07-07
- [x] Browser walk (dev server, visible window): imagery + gold dashed fairway line
      (bridge-converted paint layer) + red pin-flag + white distEl labels + red flag glyph
      rendered; zero `[HoleMapGL]`/validation console errors. Occlusion killed the later
      re-walk (07-06 lesson reproduced: rAF frozen while hidden — diagnosed live);
      remaining full-layer eyeball moved to PROD per Matt ("we test live on production").
- [ ] Prod eyeball (Matt, on the beta): fairway/green/halo/landing/arcs layers + aim ring

**Slice 2 — Stage C (per-delta approval)**
- [x] Present C1–C3 to Matt with before/after values — approved 2026-07-07 (C1 ship,
      C2 ship, C3 stage-for-device)
- [x] C1 semantic re-ruling + alias wiring (raw=white · adjusted=green · aligned=gold ·
      acquiring=dim white; wired: gauge hero, sheet hero, distAccent, GPS pill, GPS chip.
      Camera-modal alignment UI left untouched — unreachable since ANALYZE park, same
      status as ResultSheet) — 2026-07-07; headless-verified: hero white, labels/accent
      resolve, gates green
- [x] C2 label floor 11px (gauge label + YDS) — 2026-07-07; headless-verified 11px
- [x] C3 halo softening staged behind localStorage `tm-ee-halo-soft`='1' (default OFF =
      today's halo byte-identical) — A/B on the course with Matt before any default flip
- [ ] C4 Big Numbers mode → logged as follow-up (below)

**Wrap**
- [ ] audit-before-claim over the session's claims
- [ ] log.md entries · handoff update + rollup regen · trust anchors · commit/push ·
      notebooklm refresh verify_failed:0 · preflight green

## Sources
- Live reads this session: `client/src/pages/HoleMapGL.jsx` (810 lines), `client/src/pages/EagleEye.jsx`,
  `client/src/design/tokens.css` (EE block lines 94–143).
- Agent 1 (competitive UX): Arccos support (Feb 2025), Garmin manuals (Big Numbers, PlaysLike),
  18Birdies/Hole19/Golfshot/SwingU/Bushnell/GolfLogix/TheGrint reviews + help centers, Apple
  Typography HIG + WWDC20, MIT AgeLab Ergonomics 2020, ESRI/Penn State halo guidance — URLs in
  session transcript.
- Agent 2 (MapLibre): maplibre-style-spec source (`parse_css_color.ts`, `color.ts`,
  `validate_color.ts`), gl-js `style.ts`/`style_layer.ts`, spec CHANGELOG 19.x, WebKit blog —
  URLs in session transcript.
- [[synthesis/eagle-eye-tokenization-plan-2026-07-02]] · [[synthesis/range-rings-dispersion-build-spec-2026-07-02]]
  (eeColor establishment) · CLAUDE.md (beta gates, framing check).
