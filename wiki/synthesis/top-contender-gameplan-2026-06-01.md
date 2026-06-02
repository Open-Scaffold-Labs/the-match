---
type: synthesis
created: 2026-06-01
updated: 2026-06-01
tags: [strategy, design, roadmap, launch]
---

# The Match — "Top Contender" Elevation Gameplan

**Goal:** take The Match from aspirational to a top-spot contender against the golf-app leaders, in a short timeframe — an app that looks flawless and makes users say *"this is better than 18Birdies."*

**Premise (grounded):** the product thesis is already sound. Per `THE-MATCH-WHITEPAPER.md` §3, the leaders each have a clear weakness The Match exploits: 18Birdies (no persistent rivalry, scattered premium), Arccos ($250 hardware wall, intimidating UI), Golfshot ("functional, not beautiful," weak social), TheGrint (dated UI, handicap-first). The whitepaper's feature-gap matrix shows The Match is the only one combining live GPS + **AI rangefinder with no hardware** + **head-to-head rivalry records** + **premium design**. The thesis is differentiated. **The gap now is execution polish** — making the design, reliability, and "wow" moments actually match the ambition. This plan is about closing that gap.

**The throughline of today's session matters here:** the app keeps getting bitten by *fragile free external dependencies* (Nominatim geocoding, the 50/day Golf Course API cap, the hot-linked Unsplash background, flaky Overpass mirrors). "Flawless" is impossible while the app can silently break on-course. So reliability is Pillar 0, not an afterthought.

---

## How the Limitless Stack drives this

- **This doc (Obsidian wiki)** is the master tracker — every pillar's checklist lives here; update as items close.
- **NotebookLM** — competitive-research desk: ingest competitor teardowns + design references; query while designing.
- **Pinecone** — recall across the corpus (prior design decisions, whitepaper, audits).
- **Canva connector** — marketing + App Store assets (icon, screenshots, preview video, social).
- **Design skills** (`design:design-critique`, `design:design-system`, `design:accessibility-review`, `design:ux-copy`) — the actual elevation work.
- **Product skills** (`product-management:competitive-brief`, `write-spec`, `roadmap-update`) — specs + positioning.
- **Engineering skills** (`engineering:testing-strategy`, `architecture`, `debug`, `code-review`) — reliability + perf.
- **Claude in Chrome** — capture competitor UIs + verify our own builds on device-width.
- **Analytics connectors** (Amplitude / Pendo) — funnels + feature usage once instrumented.

---

## Pillar 0 — Reliability foundation ("flawless never breaks") · DO FIRST

**Best possible end result:** the app never visibly fails — no blank backgrounds, no 34s map stalls, no cream screens, no dead course search. Every external dependency is either owned, cached, or degrades gracefully and invisibly.

- [ ] **Self-host the home background** (kills the Unsplash DNS + Titleist-trademark + iOS `fixed` issues at once). Brand-free owned asset, served from our domain. *(Active — Pillar 1 decides the asset.)*
- [ ] **Promote Golf Course API coords to the primary geocoder; drop Nominatim** (POST-LAUNCH-TODO #23). Fix 1 already wired GC coords as a fallback — make them primary. Removes the rate-limited public Nominatim dependency.
- [x] **tm_courses read-through cache, Phase 1** — course detail cached; verified in prod (no vendor call on repeat). *(Shipped 2026-06-01, commit 1aeaf52.)*
- [ ] **tm_courses Phase 2/3** — cache search results by query; eventually own the course list in Postgres so search makes ~0 vendor calls (POST-LAUNCH-TODO #25). The 50/day free cap is a launch blocker without this.
- [x] **Overpass holes-fetch hardening** — per-mirror timeout + lz4-first + retry. *(Shipped 2026-06-01, commit 46bab3f; 34s → <1s verified.)*
- [ ] **Overpass Phase 2** — server-side persistent OSM cache + lazy per-hole geometry (POST-LAUNCH-TODO #24).
- [ ] **Error telemetry (Sentry)** — POST-LAUNCH-TODO #12. We are currently *blind* (Vercel logs age out in 24h; nothing client-side). This is the single highest-leverage reliability item — you can't fix what you can't see.
- [ ] **Anthropic spend cap + per-user rate limit** on Eagle Eye (POST-LAUNCH-TODO #13) — protect the one real per-use cost.
- [ ] **Audit every external call for graceful degradation** — Open-Meteo, ESRI tiles, Overpass, GC API, geocode. Each must fail invisibly to a sane fallback.

**Tools:** engineering:debug / code-review, Sentry connector, Supabase.

---

## Pillar 1 — Visual identity & design system ("looks flawless")

**Best possible end result:** within 3 seconds of opening, The Match reads as the most premium app in golf — cohesive, owned, distinctive, nothing generic or templated.

**First strategic decision to resolve:** there's a live tension — `tokens.css` says *"Augusta in daylight, cream & white"* and the app is currently light, but the whitepaper lists *"premium dark design"* as a differentiator. **Pick one and commit fully.** Recommendation to evaluate: a signature **"Augusta at dusk"** dark theme (deep green-black `#070C09` base, fairway-green depth, trophy-gold accents) — darker UIs read as more premium and make gold/green pop, and it's the lane no competitor owns. Decide deliberately, then apply everywhere.

- [ ] **Design-direction decision** (light vs. dark signature) — run `design:design-critique` on current screens, decide, document.
- [ ] **Owned background** — replace the photo-behind-glass pattern (dated, fights legibility) with a crafted CSS/SVG treatment in exact tokens: base gradient + subtle vignette/texture, zero dependency, pixel-perfect. (Also closes Pillar 0's background item.)
- [ ] **Type system pass** — define + enforce a strict type scale (display / title / body / caption), consistent weights, optical sizing. Audit every screen for off-scale text.
- [ ] **Spacing & component consistency** — enforce the 4pt grid + radii/shadows already in tokens; build a small primitives library (Card, Pill, Stat, Button, Sheet) so every screen composes from the same parts.
- [ ] **Motion language** — you already have great keyframes (score reveal, live pulse, legendary orbit). Extend to navigation transitions + tab changes so the whole app feels alive and intentional.
- [ ] **Iconography** — one cohesive icon set (weight, corner radius matched). No mixed sources.
- [ ] **App icon + splash + empty states** — the icon is the first impression in the App Store; empty states are where amateur apps reveal themselves.
- [ ] **Accessibility pass** — `design:accessibility-review` (contrast on the cream/gold combos, touch targets ≥44px, dynamic type). Premium == accessible.
- [ ] **UX copy pass** — `design:ux-copy` for microcopy/empty-states/CTAs with personality (the existing "/approvals" empty-state voice is the bar).

**Tools:** design:design-system, design-critique, accessibility-review, ux-copy; canvas-design + Canva for the icon/marketing; Chrome to verify at 390px.

---

## Pillar 2 — Competitive teardown & sharp differentiation

**Best possible end result:** a living competitive doc we design *toward*, and a crisp answer to "why is this better" visible in the first session.

- [ ] **Refresh the teardown** — the whitepaper analysis is from launch planning; capture the *current* UIs of 18Birdies, Arccos, Golfshot, TheGrint, Hole19 (Chrome / App Store screenshots) and re-distill steal/beat. Run `product-management:competitive-brief`.
- [ ] **Ingest into NotebookLM** — a competitor-design notebook to query during design work.
- [ ] **Define the 3 "wow" moments** a new user must hit in their first session (e.g., Eagle Eye "plays-like" yardage from a phone photo; first head-to-head record vs a friend; a live outing leaderboard). Design backward from these.
- [ ] **Map differentiators → visible UI** — every whitepaper advantage (rivalry records, no-hardware AI, big-team battle) must have a beautiful, obvious surface, not be buried.

**Tools:** product-management:competitive-brief, NotebookLM, Chrome.

---

## Pillar 3 — Flagship feature polish (the "wow")

**Best possible end result:** Eagle Eye and the rivalry/H2H system are genuinely best-in-class and demo-able in a 30-second clip that travels on golf Twitter (the whitepaper's GTM bet).

- [ ] **Eagle Eye "plays-like" parity** — match Arccos's multi-factor (slope + wind + temp + altitude) credibility, from a phone camera, no hardware (whitepaper "what to beat"). Tighten the result UI to feel like a $300 rangefinder.
- [ ] **Eagle Eye reliability + UX** — on top of today's fixes, finish the iOS map polish, add the "approx positions" honesty, smooth the analyze flow.
- [ ] **Rivalry/H2H showcase** — make per-opponent W/L history a centerpiece surface (no competitor has it). This is the emotional hook.
- [ ] **Live outing leaderboard polish** — "tournament-quality scoring in a daily driver" (whitepaper "what to beat" vs GameBook/TheGrint).
- [ ] **First-session onboarding** — land one wow moment in <60s. Spec via `product-management:write-spec`.

**Tools:** product-management:write-spec, design skills, engineering.

---

## Pillar 4 — Performance & "feels native"

**Best possible end result:** opens instantly, scrolls at 60fps, tolerates bad course cell signal, and feels indistinguishable from a native app.

- [ ] **Code-split the bundle** — the Vite build warns chunks >500kB; route-level lazy loading (Eagle Eye, etc.) so first paint is fast.
- [ ] **Asset optimization** — self-hosted, compressed, correctly sized images; preconnect/preload critical resources.
- [ ] **Offline shell** — cache the app shell so a dead-zone on the course doesn't blank the app.
- [ ] **iOS polish pass** — safe-areas, no pull-to-refresh state loss (today's fix), momentum scrolling, optional haptics in the native shell.
- [ ] **Perf budget + Lighthouse gate** in CI.

**Tools:** engineering skills, Chrome perf/Lighthouse.

---

## Pillar 5 — Instrumentation & quality (compete on data)

**Best possible end result:** we see every error and every funnel, and ship with confidence instead of finding out from a user on a course.

- [ ] **Sentry** (client + server) — shared with Pillar 0; the keystone.
- [ ] **Product analytics** — Amplitude/Pendo (connectors available): instrument signup → first round → first match → first Eagle Eye. These funnels are the scoreboard for "are we winning."
- [ ] **Test strategy** — `engineering:testing-strategy`: unit on scoring/handicap/achievements, integration on the auth + course + outing routes, a smoke suite gating deploys.
- [ ] **CI gates** — build + lint + smoke must pass before prod.

**Tools:** engineering:testing-strategy, Sentry, Amplitude/Pendo connectors.

---

## Pillar 6 — App Store launch readiness (the path to the top spot)

**Best possible end result:** a polished native-shell iOS app live on the App Store with a store presence that converts, plus the referral GTM engine running.

- [ ] **Native shell decision** — wrap the PWA (Capacitor) for App Store distribution + push + haptics + background GPS (the last unlocks Eagle Eye auto-shot-tracking, POST-LAUNCH-TODO #9). TestFlight is already in use.
- [ ] **App Store assets** — icon, screenshots, a 30s preview video (Canva) built around the 3 wow moments.
- [ ] **ASO** — keywords, title, description targeting "golf rivalry / GPS / rangefinder."
- [ ] **Review compliance** — privacy policy (done), data-use disclosures, IAP rules if billing ships.
- [ ] **GTM** — referral program (shipped) + the golf-Twitter/YouTube Eagle Eye demo (whitepaper GTM).

**Tools:** Canva (store assets), App Store Connect, product-management:roadmap-update.

---

## Sequencing — phases with a "definition of flawless" bar

**Phase 0 — this week (stop the bleeding + foundation):** Pillar 0 reliability items + the owned background (Pillar 1's background). *Bar: the app cannot visibly break on a course; background loads everywhere.*

**Phase 1 — 2–3 weeks (look flawless):** Design-direction decision, design-system + type/spacing/motion passes, competitive teardown refresh, app icon. *Bar: a stranger swiping through screenshots assumes it's a funded, shipping product.*

**Phase 2 — flagship + performance:** Eagle Eye + rivalry showcase polish, onboarding wow, code-split/perf. *Bar: a 30s demo clip is genuinely impressive; app opens instantly.*

**Phase 3 — measure + launch:** Sentry + analytics + tests + CI; native shell + App Store assets + ASO. *Bar: shippable to the App Store with instrumentation to compete.*

---

## Immediate next actions (Phase 0, this session or next)

1. Decide light vs. dark signature direction (15-min `design:design-critique` on current screens).
2. Build the owned CSS/SVG background → ship it (closes the live background bug).
3. Promote GC API coords to primary geocoder, drop Nominatim.
4. Stand up Sentry (unblocks visibility for everything else).

*Master tracker: this file. Update checkboxes as items close; log each in `wiki/log.md`.*
