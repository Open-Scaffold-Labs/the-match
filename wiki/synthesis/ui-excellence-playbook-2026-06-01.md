---
type: synthesis
created: 2026-06-01
updated: 2026-06-01
tags: [design, ui, brand, playbook]
---

# The Match — UI Excellence Playbook (premium editorial light)

**Direction (decided 2026-06-01):** premium **editorial light**, not dark. Reason, audited honestly: golf is played outdoors in bright sun, and a high-luminance light UI stays legible where dark glares/washes out — which is why ~every leading golf app (18Birdies, Golfshot, GolfLogix, TheGrint) is light. The *opportunity* is that they're all light-but-**bland**; none are *beautifully* light. Premium editorial light is sun-correct **and** the open lane no competitor owns. Dark is reserved only where it earns it: Eagle Eye's satellite map + an optional night mode.

This playbook turns researched, sourced principles into specific moves for our brand. It's the execution layer of Pillar 1 in [[synthesis/top-contender-gameplan-2026-06-01]].

> **Audit note:** the *principles* below are sourced from the web (citations at bottom). The *application to The Match* is design judgment, not yet built or visually verified — this is a plan, not a claim of done.

---

## The 7 principles → what we do with each

### 1. Restraint & ruthless hierarchy
*Finding:* 2026 premium UI is about restraint — calmer screens, one clear primary action, intentional whitespace; "remove anything that doesn't help the user." (uxcam, onething)
**Our move:** every screen gets ONE hero action and one focal element. Strip the Home hero card's competing elements. Whitespace becomes a material, not leftover space. Kill the photo-behind-glass clutter.

### 2. A distinctive, cohesive theme + a signature element
*Finding:* Apple Design Award visual winners share "a distinctive and cohesive theme," stunning imagery, modern balanced typography/iconography, and tasteful haptics. (Apple Design Awards 2025)
**Our move:** commit to ONE ownable signature most-beautiful-in-golf moment and design around it — a **broadcast-grade Masters-style scorecard/leaderboard** and a boxing-style **"tale of the tape" head-to-head rivalry card** (no competitor has this). One cohesive icon set, one illustration style.

### 3. Typography as the hero (the cheapest luxury signal)
*Finding:* the 2-font rule (one display, one body); ~5 text styles max; 1.25 (major-third) scale; serif-display + sans-body is the classic premium pairing (e.g. Playfair/Cormorant + Inter); 16px min body; "spacing does the work — the same font reads premium or cluttered by spacing alone." (appypie, Medium/ATNO, Toptal)
**Our move:** keep the serif for brand + big numerals (wordmark, scores, HCP, yardages), pair with a clean sans (Inter/SF) for body/labels. Define exactly 5 styles on a 1.25 scale; enforce everywhere. Increase line-height + letter-spacing discipline — most of the "premium" jump is spacing, and it's free.

### 4. Sophisticated color: muted base + one signal accent
*Finding:* high-end palettes = a muted base with strong colors saved as accents used "in small doses (buttons, badges, chart highlights)"; keep the accent controlled so it reads deliberate, not decorative. (media.io, IxDF)
**Our move:** warm **linen/paper** base (not the washed cream + photo) — think a luxury Masters program. **Gold becomes the single signal accent**, used sparingly (primary CTA, key numerals, fine rules) — never sprayed. Fairway-green for structure/text; the score colors (eagle-gold / birdie-blue / bogey-amber / double-red) are the data accents.

### 5. Real depth & materiality (not flat)
*Finding:* depth reads premium; soft shadows + layered elevation (3–4 levels) create it; warm/softened light tones pair with shadows so they stay visible (shadows read better off slightly-tinted surfaces than pure white/black); "Liquid Glass"/translucency used thoughtfully for hierarchy. (media.io, Toptal, uxcam)
**Our move:** cards *lift* off the paper with the soft layered shadows already in `tokens.css` (`--tm-shadow`, `--tm-glow-gold`). Use a 3-level elevation system consistently. Slightly-warm paper (not pure white) so shadows read. Subtle frosted translucency only for sheets/overlays.

### 6. Purposeful motion + haptics
*Finding:* micro-interactions guide and reduce friction when purposeful (not decorative); haptics are a "nice touch" called out by Apple. (uxcam, Apple Design Awards)
**Our move:** we already have strong keyframes (score reveal, live pulse, legendary orbit) — extend to nav/tab transitions and the signature scorecard. Add haptics in the native shell (Pillar 6).

### 7. Accessibility = premium (and = sun-legibility)
*Finding:* accessibility is now baseline — contrast, ≥44px targets, scalable text, readable in all conditions. (uxcam, ailoitte)
**Our move:** fix the current gold-on-cream contrast failures (they read as "cheap" precisely because contrast is low); ink-green text on warm paper passes easily and is sun-legible. ≥44px targets (mostly there). This principle *is* the sunlight argument — they're the same requirement.

---

## The Match-specific spec (starting point)

- **Canvas:** warm linen paper (owned, CSS — no external photo). Imagery used only full-bleed in deliberate hero moments with a proper gradient scrim, never behind a data grid.
- **Type:** serif display (brand + numerals) + Inter/SF body; 5 styles @ 1.25; 16px+ body; generous spacing/line-height.
- **Color:** linen base · ink-green text · **gold as the one signal accent, sparingly** · score colors for data.
- **Depth:** 3-level elevation, soft layered shadows, cards lift off paper; frosted only for sheets.
- **Signature:** broadcast scorecard + tale-of-the-tape rivalry card as the hero components.
- **Motion/haptics + accessibility:** purposeful, contrast-clean, ≥44px.

## Build sequence (each verified before merge)

1. Refine `tokens.css` to the playbook (paper base, type scale, elevation, accent discipline).
2. Build a small primitives set (Card, Stat, Pill, Button, Sheet) so every screen composes identically.
3. Convert Home to the playbook → preview → verify.
4. Build the **signature scorecard** (the wow) → verify.
5. Tale-of-the-tape rivalry card → verify.
6. Roll remaining screens; motion + accessibility pass.
*(Preview verification needs the Vercel Preview env to have DB access — currently `db:false` on previews; fix that env scoping so previews are testable.)*

## Sources
- [Mobile UX Design: Complete Guide 2026 (uxcam)](https://uxcam.com/blog/mobile-ux/)
- [UI/UX Design for Mobile Apps (Onething Design)](https://www.onething.design/post/ui-ux-design-for-mobile-apps)
- [Top 15 Mobile App Design Principles 2026 (Ailoitte)](https://www.ailoitte.com/blog/top-15-mobile-app-design-principles-and-guidelines/)
- [2025 Apple Design Award winners & finalists (Apple)](https://www.apple.com/newsroom/2025/06/apple-unveils-winners-and-finalists-of-the-2025-apple-design-awards/)
- [App Typography Guide: 2-Font Rule (Appy Pie)](https://www.appypie.com/blog/app-typography-guide)
- [Typography in UI Design: 10 Rules (Medium / ATNO)](https://medium.com/@atnoforuiuxdesigning/typography-in-ui-design-10-rules-that-will-instantly-improve-your-interfaces-60604c8cb825)
- [Typography for Mobile Apps (Toptal)](https://www.toptal.com/designers/typography/typography-for-mobile-apps)
- [UI Color Palette 2026 (IxDF)](https://ixdf.org/literature/article/ui-color-palette)
- [Muted Colors guide (Wavespace)](https://www.wavespace.agency/blog/muted-colors)
- [Principles of Dark UI Design / shadows on tinted surfaces (Toptal)](https://www.toptal.com/designers/ui/dark-ui-design)
