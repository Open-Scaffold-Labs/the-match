---
type: synthesis
created: 2026-07-20
updated: 2026-07-20
tags: [rollup, notebooklm]
---

# Closed Audits & Completed Plans Rollup

> Closed audit reports (04-29, 05-07), the closed audit-fixes proposal, and the fully-shipped Match-page completion plan.
> Rolled up 2026-07-20 (50-source cap prune, Matt-approved). The individual
> pages remain in wiki/synthesis/ (git + Obsidian); ONLY this concatenation
> occupies a NotebookLM slot. If any rolled page is edited, REGENERATE this
> file (same concatenation order) and refresh — the originals are in the
> manifest's exclude_paths and will not sync individually.


============================================================================
=== SOURCE PAGE: audit-2026-04-29.md
============================================================================

---
type: synthesis
created: 2026-04-29
updated: 2026-05-01
tags: [audit, the-match, bugs, backlog]
---

# The Match — Static Audit (2026-04-29)

> **Status (2026-05-01):** Most of the original "Recommended priority" list has shipped. See [[synthesis/audit-fixes-proposal-2026-04-29]] for the full closed queue with commit refs. The body of this audit is preserved as the historical snapshot from 2026-04-29; the **"Updated priority list (after runtime findings)"** section near the bottom has been re-marked to show what's still open.
>
> One important correction since the audit: **U1 was deferred and remains so**. Outing.jsx has grown from 2,020 → 3,324 lines (the scoreboard / Augusta-board / Match-page rebuilds all landed inside the monolith). Splitting it is now higher priority than at the time of the original audit.

> Comprehensive code review of the-match codebase. ~6,800 lines of client code (7 pages, 8 components), ~1,800 lines of server code (10 route files), 4 migrations, no test suite. Production deployed on Vercel. This audit is static (read-the-code) only — runtime smoke test deferred. Findings categorized: **bugs**, **security**, **UX issues**, **technical debt**, **missing features**.

## Surface inventory

**Client routes** (no React Router — uses tab state):
- `home` (Home.jsx, 1,872 lines) — dashboard, friends, availability calendar, modals (add friend, schedule, profile, season-start)
- `outing` (Outing.jsx, 2,020 lines + ActiveRound.jsx, 432 lines + AugustaBoard.jsx) — match hub with 7 views: hub, live, code-share, end, rivalry, solo, board
- `eye` (EagleEye.jsx, 1,457 lines) — AI rangefinder, course search, OSM satellite map, image analysis
- `stats` (Stats.jsx, 331 lines) — handicap, score trend, club distances, recent rounds
- `tour` (PGAScores.jsx, 449 lines) — live PGA leaderboard via ESPN public API

**Server routes** (10 files, all gated by `requireAuth` except `/api/auth/*`):
- `auth` — signup, login, /me (email + 4-digit PIN, 90-day JWT)
- `rounds` — list, create, get-by-id
- `stats` — summary (handicap + averages + top clubs)
- `outings` — full match lifecycle: create, join (single/bulk), scores, host scores, marker scores, guests, end, markers, teams, rivalry, my-rivalries, recent
- `eagle-eye` — analyze (image → Anthropic Sonnet 4) + osm proxy
- `profile` — get, update, avatar, start-season
- `friends` — list, search, request, respond, delete, get profile
- `games` — create, list, respond, set course, broadcast, invite (these are tee-time invites)
- `availability` — month calendar, post availability, confirmed games, tee requests CRUD
- `courses` — search/get via golfcourseapi.com (used by EagleEye for course selection)

---

## 🔴 BUGS — fix soon

### B1. CLAUDE.md feature status is stale
The "Feature status" table claims Active Round, Outing, Big Team Battle, Stats+handicap, AI Caddie are 🔲 Next. **Reality**: Active Round (ActiveRound.jsx) is wired through Outing's solo view. Outing.jsx is 2,020 lines of fully-shipped match flow. Stats.jsx ships handicap + trend chart + club distances. Only Big Team Battle and AI Caddie are genuinely unshipped.
**Fix**: rewrite the feature status section to reflect what actually ships.

### B2. Background image is a hardcoded Unsplash URL
`App.jsx` uses `https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=1200&q=90` as the base background. If Unsplash removes the photo or rate-limits the CDN, the entire app loses its background. No fallback declared.
**Fix**: bundle a local hero image + use it as fallback (`background-image: url(/hero.jpg), url(unsplash...)`), or self-host.

### B3. Token in URL fragment
`App.jsx` reads `window.location.hash` for `#token=...` after auth bounce. Fragment isn't sent in HTTP requests, but it IS visible in `document.referrer` for any link the user clicks while the fragment is in the URL, **and** the fragment lives in browser history until the user clears it.
**Fix**: After parsing, replace state immediately (already done with `replaceState`) — that part is correct. But also clear the fragment via `window.location.hash = ''` to scrub history. Or use a server-side cookie set with HttpOnly + Secure + SameSite=Lax.

### B4. JWT in localStorage — XSS risk
`tm_token` lives in `localStorage`. Any successful XSS (untrusted input rendered without escaping anywhere in the React tree, or a compromised npm package) lifts the token. 90-day expiration makes the blast radius large.
**Fix**: Move to HttpOnly cookies. Requires server changes (set cookie in /login response, parse in middleware) + CSRF protection. Medium-effort, real security win.

### B5. No rate limiting on auth endpoints
`/api/auth/signup` and `/api/auth/login` have no rate limit. With email + 4-digit PIN (only 10,000 combinations), brute-force is realistic.
**Fix**: Add `express-rate-limit` (or similar) to /auth routes. Lock to N attempts per IP per minute. Track failed-login counts on the user row and lock the account after K failures.

### B6. PIN-only auth is weak
4-digit PIN ÷ 10,000 ÷ N seconds = brute-forceable in <1 day even with rate limiting. Documented as "no OAuth for now" in CLAUDE.md.
**Fix**: Add Sign-in-with-Google / Apple as primary auth, keep email+PIN as fallback. Or expand PIN to 6 digits (10⁶ → meaningfully stronger). Long-term: OAuth.

### B7. 57 console.log/error/warn statements in production code
Many in EagleEye for OSM debugging. Some are useful diagnostics, others are leftover debug. They run in production unconditionally.
**Fix**: Gate behind `if (import.meta.env.DEV)` or remove. Use a single structured logger module so it can be disabled in prod via env flag.

### B8. No deep linking / browser back support
Tab state lives in React `useState` — refreshing the page returns to Home, browser back button exits the app. Sharing a specific outing/profile via URL is impossible.
**Fix**: Add React Router. Each tab gets a route (`/`, `/match`, `/eye`, `/stats`, `/tour`). Modals optionally use search params (`?friend=123`). Outing live view should be `/match/:code` so URLs are shareable.

### B9. EagleEye depends on Overpass API without fallback
OSM lookups via `overpass-api.de`. No retry on 429, no fallback if Overpass is slow. Gap-fill logic helps, but a full Overpass outage leaves Eagle Eye unusable.
**Fix**: Add retry with backoff + cached fallback ("we couldn't load fresh hole positions, using cached from last visit"). Already has 7-day localStorage cache; surface it on failure.

### B10. Anthropic SDK has no `apiKey` arg in `eagle-eye.js`
```js
const client = new Anthropic()  // relies on ANTHROPIC_API_KEY env var
```
Works because the SDK reads from env. Fine, but documenting that contract more visibly (or passing explicitly with `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`) prevents surprises.

### B11. No error boundary in React
If any component throws, the whole app shows a blank screen. No `<ErrorBoundary>` wraps the page tree.
**Fix**: Add a top-level `<ErrorBoundary>` with a friendly fallback UI + error reporting.

### B12. `db.one` returns `null` on no row — silent typing risk
Tracking by code review: routes assume `db.one` returns the row or null. For any field accessor that doesn't null-check (e.g., `outing.code.toUpperCase()` after `db.one`), a missing row crashes with `cannot read property of null`.
**Fix**: Audit every `db.one` callsite for null-checking. Or wrap into helpers like `db.oneOrThrow` and `db.oneOrNull` so the contract is in the function name.

---

## 🟡 UX issues — feels broken, isn't a crash

### U1. Pages are massive (single-file 1,500–2,000 lines)
Outing.jsx 2,020 lines, Home.jsx 1,872, EagleEye.jsx 1,457. These mix routing logic, modal management, network code, presentation, validation in one file. Slows iteration, increases regression risk.
**Fix**: Split each into a small parent + sibling files: `Outing/index.jsx`, `Outing/Hub.jsx`, `Outing/Live.jsx`, `Outing/Modals.jsx`, etc. ~200 lines each.

### U2. No loading skeleton or transition on tab change
Switching tabs is instant React state but each tab fires its own `fetch` in `useEffect`. Users see blank for ~200–800ms while data loads. No intermediate UI.
**Fix**: Add `<Skeleton>` placeholders matching each tab's layout. Or pre-fetch on hover.

### U3. No empty-state for friend list / outings list
Friends list shows nothing when empty rather than "Add your first friend." Same for outings.
**Fix**: Empty-state components with CTA buttons.

### U4. Mobile-only by design — no desktop layout
Hardcoded `maxWidth: 430` clamps to phone width. Anyone on tablet/desktop sees a tiny phone-shaped column with empty space on each side.
**Fix**: Either accept mobile-only (most golf-during-round usage is phone) and document, OR add a desktop layout for the at-home use cases (planning a match, reviewing stats).

### U5. No PWA manifest / install prompt
Mobile-only PWA per CLAUDE.md, but I don't see `manifest.json` or service worker config. iPhone "Add to Home Screen" works without one but loses splash, theme color, icon.
**Fix**: Add `client/public/manifest.json` + `<link rel="manifest">` + theme-color meta + apple-touch-icon set.

### U6. No offline mode
Round-tracking on a course with bad cell signal will fail every API call. No queue-and-retry.
**Fix**: Service worker caching of API GETs + IndexedDB queue for POSTs (e.g., score submissions during a round). Sync when back online.

### U7. AugustaBoard component referenced but not on a tab
`AugustaBoard.jsx` exists, imported by Outing.jsx for the `view === 'board'` state. The leaderboard is gated behind clicking through Outing — discoverability is low.
**Fix**: Add a "Live Board" entry point on Home for active outings, or expose it as its own bottom-nav slot during a live match.

### U8. PGA scores via ESPN's undocumented API
PGAScores.jsx hits `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard` directly. No CORS proxy. May break when ESPN changes routes (they don't version this API). Player headshots load from `a.espncdn.com` directly — same risk.
**Fix**: Server-side proxy `/api/pga/scoreboard` so clients get a stable contract + you can swap providers later. Cache on the server (5–30s TTL).

### U9. No avatar upload UX visible
Migration 004 adds avatar columns but I didn't see an upload form in Login or in the start-season modal. `/api/profile/avatar` exists.
**Fix**: Wire a profile-edit avatar picker (even just a URL input + file upload via FormData).

### U10. Eagle Eye uses GPS but no permission UX
EagleEye assumes `navigator.geolocation` works. If the user denies, behavior is unclear (probably falls back gracefully, but worth verifying + adding an empty state with "Tap to enable location").

### U11. Stats page hardcodes "Best 8 of last 20" / "USGA method" labels
Real handicap rules require a minimum number of rounds before a handicap is calculable. The display shows '—' which is good, but no explainer for *why* it's '—' until the user has 5+ rounds.
**Fix**: Add a contextual hint: "Need at least 5 rounds to calculate" when summary.handicap is null.

---

## 🟠 Technical debt

### T1. No test suite
Zero tests across client + server. ~8,600 lines of code with no automated regression coverage.
**Fix**: Start with Playwright E2E for the critical flows (signup, create outing, submit scores, end match). Then unit tests for the pure functions in utils (handicap calc, score color logic, score parser). Vitest for client, Jest or node:test for server.

### T2. Duplicated styling — inline styles everywhere
Most components use inline `style={{...}}` rather than Tailwind classes (despite Tailwind v4 being in the stack). Inconsistent across files. Hard to apply theme changes globally.
**Fix**: Migrate to Tailwind utility classes for spacing/colors. Keep inline styles only for dynamic values (gradients, animations).

### T3. No design system primitives
`primitives/Button.jsx`, `Card.jsx` exist but most pages use bespoke buttons/cards inline. The primitives are barely used.
**Fix**: Audit the inline buttons across Home/Outing/EagleEye, replace with `<Button variant="primary|ghost|...">`. Same for Card.

### T4. CLAUDE.md doesn't describe self-heal status
Per the new template, every project's CLAUDE.md should declare its self-heal phase (none/diagnostic/full). The-match's CLAUDE.md says "phase: none" — but the standard would have you also declare what's needed to move to phase 1.
**Fix**: Add a "Self-heal rollout plan" section: what would the diagnostic-only phase look like for the-match? Probably worth doing once the app has 50+ active users so bug reports have signal.

### T5. No CI/CD config
No `.github/workflows/`. Vercel auto-deploys on push, but there's no test-run-before-deploy, no lint-on-PR, no build-check.
**Fix**: Add a GitHub Actions workflow that runs `npm run lint` + (eventual) tests on every PR. Block merge on failure.

### T6. Migrations only forward
4 migrations, all CREATE/ALTER. No down migrations, no rollback strategy. Safe enough at this scale, but worth noting.
**Fix**: Optional — add `-- DOWN` sections in each migration with the rollback DDL, even if never used. Makes intent explicit.

### T7. Server has no structured logging
`console.error('[error]', err.message)` prints to Vercel logs, but no request ID, no user context, no severity levels.
**Fix**: Add a request-id middleware + a structured logger (pino is light + fast). Log errors with user.id (when authenticated) + req.path + status. Future self-heal pipeline depends on this.

### T8. `tm_token` localStorage key — no namespacing for multi-account
Multi-tenancy or multi-account login isn't supported (browsing as Player A then Player B requires logout/login). Fine for now, but the localStorage key (`tm_token`) doesn't account for it.

### T9. EagleEye OSM caching mixes module-level Map + localStorage
`osmPositionCache` (in-memory) + `lsLoadOsm` / `lsSaveOsm` (localStorage). Two layers, two formats. Module-level cache is lost on hard reload, localStorage survives. Cohesion is fine but there's no cache-invalidation on stale data.
**Fix**: Single `useCache(key, ttlMs)` hook that handles both layers + manual invalidation + version stamping (so a code-bump can wipe stale caches).

### T10. `routes/eagle-eye.js` parses raw image bytes synchronously
The JSON body limit is 10mb, but uploading a 9.5mb image base64-encoded becomes ~12.7mb on the wire. Vercel serverless has 4.5mb default body limit on Edge; this would fail.
**Fix**: Use multipart/form-data + streaming upload to Anthropic. Or check if `vercel.json` raises the limit; otherwise resize client-side before upload (already done? worth verifying).

---

## 🟢 Missing features (backlog candidates)

Per the whitepaper + CLAUDE.md feature status:

### F1. AI Caddie chat (mentioned in roadmap)
Conversational AI that suggests club selection, course strategy, gives swing feedback. Eagle Eye is single-shot image analysis; this is multi-turn.
**Effort**: Medium. Reuse Anthropic SDK + add a chat route + a chat UI screen.

### F2. Big Team Battle (mentioned in roadmap)
Schema already has `team` column on `tm_outing_participants` (A/B). UI flow for A vs B isn't there yet.
**Effort**: Medium. Outing creation gets a "Big Team Battle" format option, joins assign teams, scoring sums per team.

### F3. Apple Health / wearable integration
Pull walking distance, calories, HR during round → enriches Stats page.
**Effort**: Medium-High. iOS HealthKit needs native bridge; PWA can't access it directly.

### F4. Course conditions
Weather is wired in EagleEye. Surface course conditions (greens speed, fairway firmness, course alerts) on the home dashboard for friends' courses.
**Effort**: Low for weather UI; High for greens/fairway data (no public API).

### F5. Tee-time booking integration
GolfNow / Supreme Golf / 18Birdies have booking APIs. Wire `/api/games/:id/book` → opens external booking flow with course + party size pre-filled.
**Effort**: Medium. Each provider has its own auth model.

### F6. Push notifications
Friend requests, match invites, results. PWA push needs service worker + notification permission flow + backend push subscription storage.
**Effort**: Medium. Web push is mostly standard now.

### F7. Stats per course
Currently aggregate. Show "your scoring at Augusta National" if the user has played there >2 times.
**Effort**: Low. Add a `course_id` index on rounds + a `/api/stats/by-course` endpoint.

### F8. Hole-by-hole during a round (instead of total at end)
Active Round currently stores totals. Per-hole scores already exist in the schema (`scores JSONB` on participants). Surface a hole-by-hole entry UI during live play.
**Effort**: Low-Medium. ActiveRound.jsx exists at 432 lines; needs to wire hole-by-hole.

### F9. Session sharing (spectator mode)
Friends not playing watch a live outing's leaderboard. Schema's there. Need a public-or-link-shared read-only endpoint.
**Effort**: Medium. Plus changes to auth model for public links.

### F10. Daily streaks / habit tracking
Played a round today? Streak +1. Already 7 days? Badge. Common app gamification.
**Effort**: Low. New `tm_streaks` table + display on Home.

### F11. Score prediction / par-or-better tracker
"You're +2 through 5 — typical pace is +5 through 9 for you. On track to break 80." Statistical model on per-hole scoring history.
**Effort**: Medium-High. Needs per-hole history (F8 first), then a forecasting model (linear regression at first).

### F12. Course conditions/alerts subscription
"Notify me when Whistling Straits drops below $X greens fee" or "Augusta National 9-hole option becomes available." Affiliate-revenue play.
**Effort**: High. Out-of-stack (needs scrapers/integrations).

### F13. Match replay / hole-by-hole story view
After a match ends, generate a narrated hole-by-hole summary ("You won 3 holes in a row from 7–9 to take the lead"). LLM-generated.
**Effort**: Medium. Add an endpoint that takes scores + generates a recap via Anthropic.

### F14. Friend leaderboard / season stats ranking
"Where do I rank among my friends this season?" — average score, rounds played, head-to-head wins.
**Effort**: Low. Aggregate query, render on Home or Stats.

---

## 🔵 Server endpoints — coverage check

Every endpoint in the server is reachable from at least one client call (via dynamic URL interpolation). No dead routes detected.

**Endpoints confirmed in use** (sampled by reading client + grepping URLs):
- All 3 `/api/auth/*` — Login.jsx
- `/api/rounds`, `/api/rounds/:id` — Stats, ActiveRound
- `/api/stats/summary` — Stats
- `/api/outings/*` (12 endpoints) — Outing
- `/api/eagle-eye/analyze`, `/api/eagle-eye/osm` — EagleEye
- `/api/profile/*` — Home start-season modal, profile edit
- `/api/friends/*` — Home friends panel + FriendProfile component
- `/api/games/*` — Home tee-time invites
- `/api/availability/*` — Home calendar
- `/api/courses/search`, `/api/courses/:id` — EagleEye course picker

---

## Verification status

- ✅ Static read-through of every route file + every page file
- ✅ Auth pattern verified (all routes except `/auth/*` have `requireAuth`)
- ✅ SQL parameterization verified (no string-templated queries → no injection)
- ✅ TODO/FIXME sweep (only placeholder strings, no real TODOs)
- ✅ Console.log census (57 calls — categorized in B7)
- ✅ Runtime smoke test via Chrome MCP on `https://the-match-roan.vercel.app` — see "Runtime findings" below

---

## Runtime findings — Chrome MCP click-through (2026-04-29 PM)

Ran the live deployment on Chrome via Chrome MCP. Matt's session was already authenticated. Clicked through every tab and tested key flows. **8 new runtime bugs found** that the static audit missed, plus several static findings confirmed.

### 🚨 R1. Match tab: button + header overlap on wider viewport
"+ Create / Enter a Code" row, "Solo Round / Leaderboard" row, and "YOUR RIVALRIES" header all collide visually. The "No rivalries yet" empty-state text becomes unreadable. **Confirms U4 but worse than expected** — it's not just narrow on desktop, sections actively overlap on viewports >430px wide. Probably fine on a real phone but actively broken in any preview/desktop test.
**Fix**: explicitly clamp the Match-tab content to `maxWidth: 430` and use `flex-direction: column` for the action rows (so they don't side-collapse).

### 🚨 R2. Course search + Course detail escape the mobile container
Click "Select Course" from Eagle Eye → search modal goes full-viewport (1500px+) and the bottom nav disappears. Same on the course detail page. The `maxWidth: 430` clamp in App.jsx wraps the tab content, but EagleEye's modals render outside that — likely via `<Portal>` to `document.body`.
**Fix**: render the modals inside the same parent container, or wrap them in a `maxWidth: 430` panel themselves.

### 🚨 R3. Tee selector shows duplicate options (real bug)
Course detail for Pebble Beach displays:
> Blue (6823y), Gold (6464y), White (6114y), Green (5481y), Red (5251y), **Gold (6464y), White (6114y), Green (5481y), Red (5251y)**

The non-Blue tees appear twice. Cause: `routes/courses.js` returns `tees.male` and `tees.female` as separate arrays. The client (in EagleEye) flat-maps them into one chip row without dedupe, and Gold/White/Green/Red exist in BOTH male and female trees.
**Fix**: either (a) dedupe by `tee_name + total_yards` in the client before rendering, or (b) visually section the picker as "Men's tees" / "Women's tees" with subheaders. Option (b) is more useful for couples / mixed groups.

### 🚨 R4. Home and Stats disagree about whether the user has stats
Home dashboard renders **"+17.0 HCP INDEX"** in the Season 2025 card. Stats tab renders **"No rounds yet — Play your first round to see your handicap, score trend, and club distances."** Both are correct given the user has 0 rounds + a manually-seeded `start_season` handicap, but the conflicting display is confusing.
**Cause**: Home reads from `/api/profile` (which includes the seeded `handicap` field). Stats reads from `/api/stats/summary` (which is null when rounds=0). The two endpoints have different "do you have stats?" answers.
**Fix**: Stats should also display the seeded handicap when `summary` is null but `user.handicap` is set, with a hint like "From start-of-season setup. Play 5 rounds for a calculated index."

### 🚨 R5. Empty-state text and lower leaderboard rows lose contrast against the golf-ball background
Two distinct cases:
- **Stats empty state**: the "No rounds yet" headline and the bar-chart icon sit directly over the brightest part of the golf-ball image. Text is barely legible.
- **Tour leaderboard**: rows for Joel Dahmen, Sahith Theegala, David Lipsky (~rows 6-8) are partially transparent against the ball image — names and "E" scores blend in.
**Fix**: Add a semi-opaque dark overlay (`background: rgba(0,0,0,0.4)`) on each row card / empty-state container. Or replace the page-wide background with a solid fill on these tabs.

### 🚨 R6. Home "Upcoming Tee Times" — visually similar duplicates
Three "Wed, Apr 29" entries appear in a row, all with similar friend lists ("Matt Lavin / Chris Murphy / Open spot ×3", "Matt Lavin / Dale Johnson / Open spot ×3", "Matt Lavin / Chris Murphy / Open spot ×3"). They might be different tee times on the same day, but no time field is shown and no event title differentiates them. **Indistinguishable** in the UI.
**Fix**: render time-of-day prominently (e.g., "8:00 AM", "1:30 PM"), and/or show match-format / event-type so each entry is identifiable.

### 🚨 R7. Tour shows "RD 0" for Cadillac Championship
The tournament hasn't started yet (Round 0). Showing "RD 0" is technically accurate but unhelpful — most users will read it as "stuck loading."
**Fix**: When `currentRound = 0`, show "Pre-tournament" or "Starts Thursday" or "Tee off Thu 7:30 AM ET". Pull start time from the ESPN API response.

### 🚨 R8. "Book a Tee Time" external link
On Home: "Book a Tee Time / GolfNow / Integration coming soon" — clicking it opens `https://www.golfnow.com/tee-times` in a new tab (so the link works), but the "Integration coming soon" subtext suggests it's a stub. It IS a stub — there's no in-app booking flow. **Confirms F5** in the missing-features list.
**Fix (short-term)**: Either commit to the deep-link UX ("Search GolfNow" button) and remove the "coming soon" copy, or actually build the integration. Saying "coming soon" without an ETA is anti-pattern.

### Validated static findings
- **B2 (hardcoded Unsplash background)** ✅ confirmed — see R5 for the contrast fallout
- **U4 (mobile-only design)** ✅ confirmed — see R1 + R2 for the worse-than-expected manifestations
- **U5 (no PWA manifest)** — couldn't verify in this session (no iOS install test); still likely
- **F5 (no booking integration)** ✅ confirmed — R8 shows the stub
- **No JS errors** in the running app (only one benign Chrome-extension messaging warning)
- **Server is responsive** — no 500s, no 404s, course search hits external API and returns

### Things that worked well in the live app

- **Eagle Eye landing screen** is excellent — clean gold-on-black design, clear CTAs (Enable Location, Select Course), feature pills (GPS Live / AI Analysis / Weather)
- **Bottom nav with raised gold center button** is a strong signature element
- **Outing list** with `LIVE` / `Final` status badges is clean
- **Live PGA leaderboard** auto-loads with player headshots, position, today/total scores, and a refresh timestamp
- **Friend cards** show last-round + course + handicap cleanly
- **Loading states** kicked in fast (Vercel cold-start handling worked — `/health` pre-warm visible)

### Updated priority list (after runtime findings) — re-marked 2026-05-01

Re-prioritized with R1-R8:

1. ~~**R3** (tee duplicates)~~ ✅ Shipped (`1fa6ee4`)
2. ~~**R4** (Home/Stats handicap inconsistency)~~ ✅ Shipped (`1fa6ee4`)
3. ~~**R5** (background contrast)~~ ✅ Shipped (`1fa6ee4`)
4. ~~**R2** (modal escapes container)~~ ✅ Shipped (`1fa6ee4`)
5. ~~**R7** (Tour "RD 0" label)~~ ✅ Shipped (`1fa6ee4`)
6. ~~**R1** (Match-tab overlap)~~ ✅ Shipped (`1fa6ee4`, `8d74a76`)
7. ~~**R6** (tee-time duplicates indistinguishable)~~ ✅ Shipped (`8d74a76` schema, `93053ba` legacy fallback)
8. ~~**R8** (GolfNow stub copy)~~ ✅ Shipped (`1fa6ee4`)
9. Then back to original B1 (CLAUDE.md feature status — ✅ shipped `1fa6ee4`), B7 (console.log — ✅ shipped `1fa6ee4`), B5 (rate limit — ✅ shipped `1fa6ee4`), **U1 (page splits — still open, now 3,324 lines)**, **B8 (React Router — still open)**, **F2 (Big Team Battle — still open)**, **F8 (per-hole scoring — still open)**.

## Recommended priority — re-marked 2026-05-01

If picking 5 things to ship next (in roughly order):

1. ~~**B1** — Update CLAUDE.md feature status to match reality~~ ✅ Shipped (`1fa6ee4`)
2. ~~**B7** — Strip/gate console.log~~ ✅ Shipped (`1fa6ee4`)
3. ~~**B5** — Rate-limit auth endpoints~~ ✅ Shipped (`1fa6ee4`)
4. **U1** — Split Outing.jsx and Home.jsx into smaller files — **STILL OPEN, NOW MORE URGENT** (Outing.jsx 2,020 → 3,324 lines)
5. **B8** — Add React Router — **STILL OPEN** (half-day, unlocks deep linking + share URLs + browser back)

After those, **F2 (Big Team Battle)** and **F8 (per-hole scoring during live play)** are the highest-value additions per the whitepaper's roadmap — both schema-supported already.

## Sources

- the-match repo at commit `dd7332f` (2026-04-29 PM, after init)
- Static read-through of all 7 pages + 8 components + 10 server route files + 4 migrations
- No runtime test performed in this audit — recommend follow-up Chrome-MCP click-through


============================================================================
=== SOURCE PAGE: audit-fixes-proposal-2026-04-29.md
============================================================================

---
type: synthesis
created: 2026-04-29
updated: 2026-05-01
status: closed
tags: [audit, fixes, the-match, closed]
---

# The Match — Audit Fixes Proposal (2026-04-29) — CLOSED

> **Status (2026-05-01): CLOSED — all queued items shipped.** Originally a proposal awaiting approval; everything in the TL;DR table below was implemented in commits `1fa6ee4`, `8d74a76`, and `93053ba` on 2026-04-29 (same day this proposal was written). The body is preserved as a historical record of what was proposed and why. For what's still open, see the bug/UX/tech-debt/missing-features sections of [[synthesis/audit-2026-04-29]] minus everything in the table below.
>
> **Shipping commits:**
> - `1fa6ee4` — F-R3, F-R4, F-R7, F-R8, F-B1, F-B7, F-B11, F-R5, F-R2, F-R1, F-B3, F-B5 (12 of the 13 queue items)
> - `8d74a76` — F-R6 part B (`tm_games.start_time` migration + UI tee-time picker + match-tab contrast pass)
> - `93053ba` — F-R6A fallback "#N of M" numbering, plus bonus: F-U3, F-B9, F-T7, F-T5; discovered F-U5 + F-U10 already done
>
> **Original proposal text below (preserved):** Concrete fix proposals for every bug + UX issue from `audit-2026-04-29.md`. Each proposal includes file path, exact diff or precise change description, test plan, and risk level.

## Approval queue (TL;DR table) — all shipped

| # | Bug | Status | Commit |
|---|---|---|---|
| **F-R3** | Tee selector duplicates | ✅ Shipped | `1fa6ee4` |
| **F-R4** | Home/Stats handicap inconsistency | ✅ Shipped | `1fa6ee4` |
| **F-R8** | "Integration coming soon" stub copy | ✅ Shipped | `1fa6ee4` |
| **F-R7** | "RD 0" pre-tournament label | ✅ Shipped | `1fa6ee4` |
| **F-B1** | CLAUDE.md feature status stale | ✅ Shipped | `1fa6ee4` |
| **F-B7** | 57 production console.log | ✅ Shipped (logger.js + 5 swept) | `1fa6ee4` |
| **F-R5** | Background contrast (Stats + Tour) | ✅ Shipped | `1fa6ee4` |
| **F-B11** | No React error boundary | ✅ Shipped | `1fa6ee4` |
| **F-R2** | Modals escape mobile container | ✅ Shipped | `1fa6ee4` |
| **F-R1** | Match tab buttons overlap | ✅ Shipped (root cause: `.page-scroll` flex) | `1fa6ee4`, `8d74a76` |
| **F-R6** | Tee-time entries indistinguishable | ✅ Shipped (Part B schema migration too) | `8d74a76` |
| **F-R6A** | Same-day fallback "#N of M" numbering | ✅ Shipped (autonomous batch) | `93053ba` |
| **F-B3** | Token in URL fragment | ✅ Shipped | `1fa6ee4` |
| **F-B5** | Rate-limit auth endpoints | ✅ Shipped (in-memory phase 1) | `1fa6ee4` |

**Bonus shipped in autonomous batch (`93053ba`):**
- F-U3 friend list empty state + "Find a friend" CTA
- F-B9 Eagle Eye Overpass defensive client handling (`safeOsm` helper)
- F-T7 structured server logging (pino + pino-http)
- F-T5 CI/CD GitHub Actions skeleton
- F-U5 PWA manifest — discovered already done
- F-U10 geolocation permission UX — discovered already done

**Still deferred (need their own scoped sessions):**
- **F-U1** Split Outing.jsx + Home.jsx — *getting worse*: Outing.jsx grew from 2,020 → 3,324 lines after the scoreboard / Augusta-board work landed inside the monolith. Strong candidate for next focused session.
- F-B8 Add React Router
- F-B4/B6 Auth security overhaul (HttpOnly cookies + 6-digit PIN or OAuth)
- F-T1 Test suite (Playwright E2E)

**Still open from the full audit (not in original proposal):**
- B2 hardcoded Unsplash background, B10 explicit Anthropic apiKey, B12 `db.one` null-handling sweep
- U2 loading skeletons, U4 mobile-only acceptance, U6 offline mode, U7 AugustaBoard discoverability, U8 ESPN API server-proxy, U9 avatar upload UX, U11 Stats handicap explainer
- T2 inline-styles → Tailwind, T3 use design-system primitives, T4 self-heal phase declaration, T6 down-migrations, T8/T9/T10 smaller cleanups
- All F1-F14 missing-feature candidates

---

## F-R3 — Tee selector deduplication (TOP PRIORITY)

**Bug**: Course detail page in Eagle Eye shows duplicate tee chips. Pebble Beach renders `Blue (6823y), Gold (6464y), White (6114y), Green (5481y), Red (5251y), Gold (6464y), White (6114y), Green (5481y), Red (5251y)`. Hits every multi-tee course.

**Cause**: `client/src/pages/EagleEye.jsx:766` flat-maps `tees.male` and `tees.female` from the API response. Most non-championship tees exist in both arrays (mixed-gender play uses the same boxes).

**Proposed fix** — dedupe by name+yardage, label gender when both versions exist:

```diff
- const tees = course ? [...(course.tees?.male || []), ...(course.tees?.female || [])] : []
+ const tees = course ? dedupeTees(course.tees) : []
```

Add helper at top of file:
```js
// Merge male + female tee arrays; dedupe by tee_name+total_yards.
// When the same tee appears in both, prefer male (typically same physical box).
// When a tee appears in only one, suffix the chip with " (W)" for female-only.
function dedupeTees(tees) {
  const result = []
  const seen = new Set()
  const malesByKey = new Map()
  for (const t of (tees?.male || [])) {
    const key = `${t.tee_name}-${t.total_yards}`
    malesByKey.set(key, t)
    if (!seen.has(key)) { result.push(t); seen.add(key) }
  }
  for (const t of (tees?.female || [])) {
    const key = `${t.tee_name}-${t.total_yards}`
    if (seen.has(key)) continue  // already in result via male array
    result.push({ ...t, tee_name: `${t.tee_name} (W)` })
    seen.add(key)
  }
  return result
}
```

**Test plan**: Open Pebble Beach → tee chips show 5 not 9. Try a women-only-tee course (e.g., a course where Red is only in `tees.female`) → it appears as "Red (W)". Existing default `teeIdx = 0` still selects Blue.

**Risk**: Low. Pure client change. Worst case: a course has weird data and dedup helper crashes — wrap in try/catch and fall back to old behavior.

---

## F-R4 — Home/Stats handicap inconsistency

**Bug**: Home dashboard shows "+17.0 HCP INDEX" (from seeded `start_season` handicap). Stats tab shows "No rounds yet — Play your first round to see your handicap." Conflicting state.

**Cause**: `Stats.jsx:197` checks `!summary && rounds.length === 0` for empty state. The user's seeded handicap lives on `tm_users.handicap` (returned by `/api/profile`) but isn't passed to Stats.

**Proposed fix** — pass `user` prop's handicap into Stats's HcpBadge with empty-state copy:

```diff
- if (!summary && rounds.length === 0) return (
-   <div style={...}>
-     <div>No rounds yet</div>
-     <div>Play your first round to see your handicap, score trend, and club distances.</div>
-   </div>
- )
+ if (!summary && rounds.length === 0) return (
+   <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
+     <div style={{ padding: '20px 20px 16px', flexShrink: 0 }}>
+       <div style={/* Stats title gradient */}>Stats</div>
+       <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.38)', marginTop: 1 }}>{user.name}</div>
+     </div>
+     <div className="page-scroll" style={{ padding: '0 16px 20px' }}>
+       <HcpBadge hcp={user.handicap ?? null} roundCount={0} />
+       <div style={{ /* nudge card */ background: 'rgba(255,255,255,0.85)', borderRadius: 16, padding: 18, marginTop: 12, textAlign: 'center' }}>
+         <div style={{ fontWeight: 800, color: '#0D1F12', fontSize: 16, marginBottom: 6 }}>
+           {user.handicap != null ? 'Showing your starting handicap' : 'No handicap yet'}
+         </div>
+         <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 13, lineHeight: 1.5 }}>
+           {user.handicap != null
+             ? 'Play 5+ rounds to switch to a USGA-method calculated index.'
+             : 'Set your starting handicap on the Home tab, or log a round.'}
+         </div>
+       </div>
+     </div>
+   </div>
+ )
```

**Test plan**: Matt's account (seeded HCP +17, 0 rounds) → Stats now shows the +17 badge with "Showing your starting handicap" subtext. New user with no seed → "No handicap yet" empty state.

**Risk**: Low. Existing `HcpBadge` already handles `hcp === null`.

---

## F-R8 — "Integration coming soon" stub copy

**Bug**: Home dashboard shows "Book a Tee Time / GOLFNOW / Integration coming soon" — but clicking it just opens golfnow.com in a new tab. The "coming soon" copy promises something not yet shipping.

**Proposed fix** — change copy to commit to the deep-link UX:

```diff
- <span style={{ ... }}>Integration coming soon</span>
+ <span style={{ color: 'rgba(13,31,18,0.55)', fontSize: 11, fontWeight: 500 }}>Search tee times in your area →</span>
```

**Test plan**: Card says "Search tee times in your area" instead of "Integration coming soon." Click still opens golfnow.com. Fewer empty promises.

**Risk**: Low. Copy-only change.

---

## F-R7 — "RD 0" pre-tournament label

**Bug**: Tour tab shows "RD 0" for tournaments that haven't started (e.g., pre-event Cadillac Championship). Looks like a bug to users.

**Proposed fix** — `PGAScores.jsx:312`:

```diff
- {ev.isComplete ? 'FINAL' : ev.inProgress ? `RD ${ev.round} · LIVE` : `RD ${ev.round}`}
+ {ev.isComplete ? 'FINAL'
+   : ev.inProgress ? `RD ${ev.round} · LIVE`
+   : ev.round > 0 ? `RD ${ev.round}`
+   : ev.startDate ? `STARTS ${formatStartDate(ev.startDate)}`
+   : 'PRE-TOURNAMENT'}
```

Add helper at top of file:
```js
function formatStartDate(iso) {
  try {
    const d = new Date(iso)
    const opts = { weekday: 'short', month: 'short', day: 'numeric' }
    return d.toLocaleDateString('en-US', opts).toUpperCase()  // e.g., "THU MAY 1"
  } catch { return 'SOON' }
}
```

**Note**: ESPN's API does include a `startDate` per event. Verify by inspecting `ev` shape in dev tools first; if it's named differently (e.g., `startDateUTC` or `date`), adjust accordingly.

**Test plan**: Cadillac Championship now shows "STARTS THU MAY 1" or similar instead of "RD 0".

**Risk**: Low. Falls back to "PRE-TOURNAMENT" if start-date parsing fails.

---

## F-B1 — CLAUDE.md feature status stale

**Bug**: `the-match/CLAUDE.md`'s feature-status section (currently inside the file) lists Active Round, Outing, Big Team Battle, Stats+handicap, AI Caddie as 🔲 Next. Outing is shipped (2,020 lines), Active Round is wired, Stats has handicap. Only Big Team Battle and AI Caddie are genuinely unshipped.

**Proposed fix** — update the table:

```diff
  ## Feature status
- 
- FeatureStatusAuth (login/signup)✅ DoneHome dashboard✅ DoneEagle Eye (AI rangefinder)✅ DoneActive Round (GPS tracking)🔲 NextOuting (tournaments)🔲 NextBig Team Battle🔲 NextStats + handicap🔲 NextAI Caddie chat🔲 Next
+ 
+ | Feature | Status |
+ |---|---|
+ | Auth (login/signup) | ✅ Done |
+ | Home dashboard | ✅ Done |
+ | Eagle Eye (AI rangefinder) | ✅ Done |
+ | Stats + handicap | ✅ Done |
+ | Outing (tournaments) | ✅ Done |
+ | Active Round / Solo Round | ✅ Done (per-hole entry pending — see F8) |
+ | Friends + Availability Calendar | ✅ Done |
+ | PGA Tour leaderboard | ✅ Done |
+ | Big Team Battle | 🔲 Next (schema exists, UI pending) |
+ | AI Caddie chat | 🔲 Next |
+ | Per-hole scoring during live play | 🔲 Next (F8 in audit) |
+ | Push notifications | 🔲 Next |
```

**Risk**: Trivial. Doc only.

---

## F-B7 — Strip 57 console.log in production

**Bug**: 57 console.log/error/warn calls in production code, mostly EagleEye OSM debugging.

**Proposed fix** — gate all client-side console statements behind a debug flag. Two-step:

**Step 1**: Add a tiny logger module `client/src/lib/logger.js`:
```js
const isDev = import.meta.env.DEV

export const log = isDev ? console.log.bind(console) : () => {}
export const warn = isDev ? console.warn.bind(console) : () => {}
export const error = console.error.bind(console)  // keep error in prod for Sentry/monitoring later
```

**Step 2**: Sweep — replace `console.log(` → `log(` and `console.warn(` → `warn(` across client files. Keep `console.error` since errors should still surface.

Approximate file list:
- EagleEye.jsx (~10 calls — mostly `console.log('[OSM] ...')`)
- Outing.jsx (~7 calls)
- Home.jsx (~3 calls)
- ActiveRound.jsx (~1)
- FriendProfile.jsx (1)
- PGAScores.jsx (probably a few)

**Test plan**: Production build (`npm run build`) → search dist for console.log → only console.error remains. Dev build keeps debug output.

**Risk**: Low. If the sweep misses some, prod just has a few stragglers. Worst case: a typo breaks a file.

---

## F-R5 — Background contrast on Stats empty state + Tour leaderboard

**Bug**: Page-wide golf-ball background image bleeds through text-heavy panels. Stats empty state and PGA leaderboard's lower rows lose readability.

**Proposed fix** — add a semi-opaque dark overlay container around the affected text:

For Stats empty state:
```diff
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', padding: '0 32px', gap: 20, textAlign: 'center' }}>
+   {/* Dark overlay for readability */}
+   <div style={{ position: 'absolute', inset: 0, background: 'rgba(7,12,9,0.50)', pointerEvents: 'none' }} />
+   <div style={{ position: 'relative' /* lift content above overlay */ }}>
    ...content...
+   </div>
  </div>
```

For PGAScores leaderboard rows: each row already has `background: 'rgba(255,255,255,0.85)'` on outer card — actually verify with a wider screenshot. The issue may be that the card doesn't extend full row width. Likely fix:

```diff
  <div /* leaderboard row */ style={{
    display: 'flex', alignItems: 'center', padding: '10px 14px',
-   background: 'transparent',
+   background: 'rgba(255,255,255,0.92)',
    borderBottom: '1px solid rgba(27,94,59,0.06)',
  }}>
```

Need to read the actual PGA row code to confirm the right place. (Not yet pulled in this proposal — flagging for verification before applying.)

**Test plan**: Screenshot Stats empty-state and Tour leaderboard before/after. Text legible across all rows.

**Risk**: Low. CSS-only changes, easy to revert.

---

## F-B11 — React error boundary

**Bug**: If any component throws, the entire app blanks out. No graceful fallback.

**Proposed fix** — add a top-level error boundary in `client/src/main.jsx`:

Create `client/src/components/ErrorBoundary.jsx`:
```jsx
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { hasError: false, message: '' }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message || 'Unknown error' }
  }

  componentDidCatch(err, info) {
    // TODO: send to monitoring (Sentry, etc.) when wired
    console.error('[ErrorBoundary]', err, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '0 32px',
        background: '#070C09', color: '#E8C05A', textAlign: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 64 }}>⛳</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Hooked left.</div>
        <div style={{ color: 'rgba(232,192,90,0.7)', fontSize: 14, lineHeight: 1.5 }}>
          Something broke. Try reloading the page. If it keeps happening, drop a note in the whiteboard.
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 12 }}>
          {this.state.message}
        </div>
        <button onClick={() => window.location.reload()} style={{
          marginTop: 12, background: '#C9A040', color: '#0D1F12',
          border: 'none', padding: '10px 24px', borderRadius: 10,
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>Reload</button>
      </div>
    )
  }
}
```

Wire it in `main.jsx`:
```diff
+ import ErrorBoundary from './components/ErrorBoundary.jsx'

  createRoot(document.getElementById('root')).render(
    <StrictMode>
+     <ErrorBoundary>
        <App />
+     </ErrorBoundary>
    </StrictMode>
  )
```

**Test plan**: Throw a deliberate error in any page (`throw new Error('test')`) → see the friendly error UI instead of blank screen. Reload button works.

**Risk**: Low. Class component, well-known React pattern.

---

## F-R2 — Modals escape mobile container

**Bug**: Eagle Eye's "Select Course" + course detail use `createPortal(..., document.body)` — they bypass App.jsx's `maxWidth: 430` wrapper and go full viewport.

**Proposed fix** — render the modal portal into a sibling-of-app container that ALSO has max-width clamp.

Add to `client/src/main.jsx`:
```diff
  <ErrorBoundary>
    <App />
+   <div id="modal-root" style={{
+     position: 'fixed', inset: 0, pointerEvents: 'none',
+     display: 'flex', justifyContent: 'center',
+     zIndex: 9999,
+   }}>
+     <div id="modal-root-inner" style={{
+       width: '100%', maxWidth: 430, height: '100%',
+       position: 'relative', pointerEvents: 'none',
+     }}/>
+   </div>
  </ErrorBoundary>
```

In EagleEye.jsx, change `createPortal` calls:
```diff
- return createPortal(<div .../>, document.body)
+ return createPortal(<div style={{ pointerEvents: 'auto' }} .../>,
+                    document.getElementById('modal-root-inner') || document.body)
```

**Test plan**: Open course search on desktop → it renders inside the 430px column, bottom nav stays visible. On phone, no visible difference.

**Risk**: Medium. Portals are tricky — if the modal-root-inner isn't ready when the portal mounts, falls back to body (status quo). Touch events / pointerEvents need testing.

---

## F-R1 — Match tab buttons + headers overlap

**Bug**: On viewports wider than 430px, Match tab's "+ Create / Enter a Code", "Solo Round / Leaderboard" rows, and "YOUR RIVALRIES" header collide.

**Cause**: The tab content already uses the App.jsx `maxWidth: 430` wrapper, but the Match-Hub view's flex layout assumes phone width. On desktop preview, the tab pages render at the column's natural width and Match seems to take a different code path.

**Proposed fix** — explicitly clamp the Match-Hub content to 430:

In `Outing.jsx` Hub view:
```diff
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 16px' }}>
+   {/* Defensive: ensure all sections stay column-stacked even on wider previews */}
    <div style={{ /* action buttons row */ display: 'flex', gap: 12, ... }}>
      <button>Create</button>
      <button>Enter a Code</button>
    </div>
    <div style={{ display: 'flex', gap: 12, marginTop: 12, ... }}>
      <button>Solo Round</button>
      <button>Leaderboard</button>
    </div>
+   <div style={{ marginTop: 24 }}/>
    <div>YOUR RIVALRIES</div>
    ...
  </div>
```

Need to read the actual Outing Hub-view code to confirm the exact diff. (Likely fix is `flex-direction: column` on the parent + explicit `marginTop` between sections.)

**Test plan**: Desktop preview at 1500px wide → Match tab shows clean column. Phone preview at 390px → unchanged.

**Risk**: Medium. Outing.jsx is 2020 lines; need to find the right Hub component without breaking the other 6 view modes (live, code-share, end, rivalry, solo, board).

---

## F-R6 — Tee-time entries indistinguishable

**Bug**: Multiple "Wed, Apr 29" upcoming-tee-time cards render with same friend list and "No course set" — no time-of-day or event-type to differentiate.

**Cause**: Schema's `tm_games` table doesn't store a time field — only `date`. So multiple tee times on the same day can't be distinguished.

**Proposed fix** — two-part:

**Part A** (low risk, copy-only): If multiple games share the same date, prefix each with "Game 1", "Game 2", etc.:
```diff
- <div>{dateLabel}</div>
+ <div>{dateLabel}{sameDateCount > 1 ? ` · #${gameIndex + 1} of ${sameDateCount}` : ''}</div>
```

**Part B** (schema change): Add a `start_time` column to `tm_games`:

```sql
-- migrations/005_tm_game_start_time.sql
ALTER TABLE tm_games ADD COLUMN IF NOT EXISTS start_time TIME;
-- Existing rows get NULL; new rows can populate via the create-game flow
```

Then surface the time in the card. Game-creation form needs a time picker.

**Risk**: Medium for Part A (UI only, low risk). Higher for Part B (schema change, server route changes, UI form addition). **Recommend Part A now, Part B as a separate scoped task.**

---

## F-B3 — Token in URL fragment lingers in history

**Bug**: After auth bounce, `App.jsx` parses `#token=...` from `window.location.hash`. The fragment lives in browser history until cleared.

**Cause**: `App.jsx:24-28` calls `window.history.replaceState(null, '', window.location.pathname)` which replaces the URL but doesn't explicitly null out the hash on subsequent reads.

**Proposed fix** — verify the replaceState is sufficient (it should be), AND for defense-in-depth scrub `window.location.hash` after parsing:

```diff
  const hash = window.location.hash
  if (hash.startsWith('#token=')) {
    const token = hash.slice(7)
    localStorage.setItem('tm_token', token)
-   window.history.replaceState(null, '', window.location.pathname)
+   window.history.replaceState(null, '', window.location.pathname + window.location.search)
+   // Also explicitly clear the hash from the live URL bar
+   if (window.location.hash) window.location.hash = ''
  }
```

**Note**: The hash is NOT sent in HTTP requests (no exposure to server logs/referrer headers), so this is mostly defensive against `document.referrer` leaks when the user clicks a link before navigating away from the auth-redirect URL. Real fix is migrating to HttpOnly cookies (see F-B4).

**Risk**: Low. If `replaceState` is already sufficient, `window.location.hash = ''` is a no-op.

---

## F-B5 — Rate-limit auth endpoints

**Bug**: `/api/auth/signup` and `/api/auth/login` have no rate limit. With 4-digit PIN, brute-force is realistic.

**Proposed fix** — add `express-rate-limit`:

**Step 1**: Add dependency to `server/package.json`:
```diff
  "dependencies": {
+   "express-rate-limit": "^7.4.0",
    ...
  }
```

**Step 2**: Apply in `server/src/routes/auth.js`:
```diff
  const router = require('express').Router()
+ const rateLimit = require('express-rate-limit')
  const bcrypt = require('bcryptjs')
  const jwt = require('jsonwebtoken')
  const db = require('../db')

+ // 5 login/signup attempts per IP per minute. Real burst protection.
+ const authLimiter = rateLimit({
+   windowMs: 60 * 1000,
+   max: 5,
+   standardHeaders: true,
+   legacyHeaders: false,
+   message: { error: 'Too many attempts. Try again in a minute.' },
+ })

  function mintToken(userId) { ... }

- router.post('/signup', async (req, res) => { ... })
+ router.post('/signup', authLimiter, async (req, res) => { ... })

- router.post('/login', async (req, res) => { ... })
+ router.post('/login', authLimiter, async (req, res) => { ... })
```

**Note**: Vercel's serverless functions reset state per cold start, so `express-rate-limit` with default in-memory store has limited effectiveness. For production, point it at the Postgres DB or use `rate-limit-redis`. **Phase 1**: in-memory (better than nothing). **Phase 2**: switch to a persistent store.

**Test plan**: Hit `/api/auth/login` 6 times in rapid succession → 6th gets 429. After 60s, allowed again.

**Risk**: Low. Won't lock real users out at 5/min.

---

## Deferred — bigger conversations needed

### F-U1 — Split Outing.jsx and Home.jsx

Outing.jsx is 2,020 lines, Home.jsx is 1,872. Both mix routing, modals, network code, presentation. Refactor candidates but high-risk to split during normal feature work.

**Recommendation**: tackle when adding the next big feature (e.g., Big Team Battle) — split Outing.jsx as part of that PR. Same for Home.jsx when adding the next dashboard module.

### F-B8 — Add React Router

Currently tab state is `useState`. Switching to React Router enables deep linking, browser back/forward, shareable URLs (`/match/:code`). Half-day of work, touches every page.

**Recommendation**: Schedule as its own focused work session. Has dependencies on how each page handles modal state.

### F-B4/B6 — Auth security overhaul

JWT in localStorage → HttpOnly cookies. 4-digit PIN → 6 digits or OAuth. Multi-day effort with thorough testing.

**Recommendation**: Schedule for after the easier security wins (B5 rate limit) prove out.

### F-T1 — Test suite

Zero tests. Recommend Playwright E2E for critical flows (signup, create outing, submit scores, end match) before any major refactor like F-U1 or F-B8.

---

## Summary of approval queue

**Recommended for immediate execution** (low-risk, high-value):
- F-R3 ✅ tee dedupe
- F-R4 ✅ Stats handicap fix
- F-R8 ✅ "coming soon" copy
- F-R7 ✅ "RD 0" label
- F-B1 ✅ CLAUDE.md feature status
- F-B7 ✅ console.log gating
- F-R5 ✅ background contrast
- F-B11 ✅ ErrorBoundary
- F-R2 ⚠ modal portal (medium risk — needs care)
- F-R1 ⚠ Match-tab clamp (medium risk — needs Outing.jsx exploration)
- F-B3 ✅ scrub URL fragment
- F-B5 ✅ auth rate-limit (in-memory phase 1)

**Discuss before executing**:
- F-R6 — Part A (UI numbering) is fine; Part B (schema migration) needs your call

**Defer to dedicated sessions**:
- F-U1, F-B8, F-B4/B6, F-T1

If you greenlight everything in the "Recommended" list, I'll execute in priority order (R3 first), commit each as its own logical change, and run a smoke test on the live deployment after each one. Estimate: ~2-3 hours total for all 12 items, with verification.

## Sources

- the-match repo at commit `38f9d52` (audit + runtime findings)
- Static + runtime audit: `wiki/synthesis/audit-2026-04-29.md`
- All file paths + line numbers verified against current code


============================================================================
=== SOURCE PAGE: audit-2026-05-07.md
============================================================================

---
type: synthesis
created: 2026-05-07
updated: 2026-05-07
tags: [audit, e2e-test, ux, bugs, ideas]
---

# Audit 2026-05-07 — End-to-end auth + visual sweep + improvement backlog

> **Status as of 2026-05-07 PM:** HIGH bugs #1 + #2 → CLOSED. MEDIUM bugs #3 + #5 (code) → CLOSED (#5 email send still stubbed — see POST-LAUNCH-TODO #14). Closures shipped in commits `56f9d15`, `b16b18b`, `ef156a1`, `6c1fd6e`, `1551bcb`. Still open: MEDIUM #4 + #6 + 5 LOW polish items. None are App-Store-submission blockers.

## Method

Drove the live production app at `https://the-match-roan.vercel.app` via the Claude-in-Chrome MCP, simulating a brand-new mobile user. Walked the full flow: signup → onboarding wizard → home → main app surfaces → wrong-PIN login → correct-PIN login. Captured network requests + console messages + screenshots throughout. Server-side auth verified via `scripts/smoke-test-auth.js` (already passing post-JWT-rotation).

Test user: `e2e-test-2026-05-07-1234@example.com` ("E2E Test User") — created during the test, deleted post-test (DB user_id=43, removed via cascade-on-delete).

## What's working

- **Signup flow** — clean, validation works, lands on onboarding wizard. 9 API calls (signup, profile updates, course search, club bag, multiple onboarding step PUTs) all 200/201.
- **Onboarding wizard** — 4 substantive steps + welcome, with progress bar, back navigation, inline validation. Copy is good. Driver brand→model dropdown is a nice depth touch.
- **Login + wrong-PIN** — POST `/api/auth/login` returns 401 on wrong PIN with "Invalid email or PIN" error (good security: doesn't reveal whether email exists). Form preserves on error so users can retry.
- **Login + correct-PIN** — 200, lands on home with welcome + permission prompt.
- **Home view** — Beautiful sunset/golf-ball background with phone-shaped centered chrome, profile card with HCP index, follow counts, win/loss/tie summary, season banner with rotating copy, "Get started" 0/5 onboarding-completion checklist.
- **Tour tab** — Polished PGA Tour leaderboard with player photos, country labels, dual-tournament tabs, last-update timestamp.
- **Eagle Eye tab** — Strong AI-rangefinder hero with "Know Every Yard. Play Every Shot." copy, GPS Live + AI Analysis + Weather feature pills, Enable Location + Select Course CTAs.
- **Coach-mark tooltips** — Used consistently across screens. "TAP TO DISMISS" pattern is clear. Copy is well-written.
- **Empty states** — Scorecard + Leagues both have intentional empty-state visual design (golf-ball hero, course-themed copy) rather than blank-with-a-button. Strong design discipline.
- **JWT rotation didn't break the running session** — locally-minted tokens validate against the rotated prod secret (eventually; first lambda call had a transient 401 before warming).

## Bugs found

Severity = impact × likelihood. HIGH = security or many-users-affected, MEDIUM = visible breakage or accessibility, LOW = polish.

### HIGH

**1. No logout / sign-out anywhere in the app.** ✅ **CLOSED 2026-05-07 PM** — `SettingsModal` opened from a kebab (⋯) icon in the home top bar; "Sign Out" clears `tm_token` + reloads. Commit `56f9d15` (initial gear) + `1551bcb` (kebab disambiguation).
Confirmed via DOM scan (`querySelectorAll('a, button')` for "logout|log out|sign out|signout" → zero matches). The only auth-clearing path is to manually clear `localStorage.tm_token`. Means: shared device → previous user stays logged in indefinitely; users wanting to switch accounts have no path; users feel uneasy because they can't end their session explicitly. JWT lasts 90 days so this isn't theoretical — it's the actual behavior.

**Fix:** add a Settings screen (gear icon top-right next to "My Profile", or under "Edit profile") with a "Sign out" button that does `localStorage.removeItem('tm_token')` + `navigate('/')`.

**2. No `/settings` route — silent SPA fallback to home.** ✅ **PARTIALLY CLOSED 2026-05-07 PM** — Settings is now a fullscreen overlay (no dedicated `/settings` route, but the entry point is visible from anywhere via the kebab icon). `/privacy` is a real route now (rewrites to static `/privacy.html`). A real `/settings` URL is still nice-to-have for deep-linking but no longer a UX gap. Commit `56f9d15`.
Navigating to `https://the-match-roan.vercel.app/settings` quietly loads the home view. Confusing for any user who guesses-the-URL, and indicates the SPA's catch-all routing isn't 404-ing unknown paths. Probably the same router issue means typos in any path silently go home.

**Fix:** add a real settings page (paired with #1) at `/settings`. Add a 404 page for unmatched routes.

### MEDIUM

**3. Course name truncation: "Pebble Beach Gl" everywhere.** ✅ **CLOSED 2026-05-07 PM** — vendor (golfcourseapi.com) returns abbreviated names. Server-side `expandCourseName()` post-processor in `server/src/routes/courses.js` expands `Gl/Gc/Cc/G&Cc/Cl/Rc` → full names. DB backfill ran across 6 tables (1 row updated; the rest were already clean). Commit `56f9d15`.
The course name "Pebble Beach Golf Links" is being cut to "Pebble Beach Gl" — visible in the onboarding course autocomplete dropdown ("Pebble Beach Gl, Pebble Beach, CA") AND in the home profile card after onboarding completes. Not a CSS overflow ellipsis (no `…`); it's the actual stored/transmitted string. Likely a 16-character `VARCHAR` truncation somewhere in the import path or a max-length on a display column.

**Fix:** check `tm_courses.name` column length; check the OSM/courses sync script; fix the truncation at the source so the full name renders.

**4. Onboarding wizard renders full-width — doesn't follow mobile-first design.**
The auth screen and the main app both use a centered phone-shaped column on wide viewports (golf course visible left/right of the chrome). The onboarding wizard does NOT — it spans the full window width. So a user starting on a desktop browser sees a desktop-styled wizard, then transitions to a mobile-styled app post-onboarding. Inconsistent and visually broken on tablets.

**Fix:** wrap the wizard in the same `max-width` container as the rest of the app's mobile chrome.

**5. No "Forgot PIN" / PIN reset flow.** ⚠️ **CODE CLOSED, EMAIL STUBBED 2026-05-07 PM** — full reset flow shipped: migration `025_tm_pin_reset_tokens.sql`, `POST /api/auth/forgot-pin` + `POST /api/auth/reset-pin`, three new Login.jsx modes (`forgot`, `forgotSent`, `reset`), `?reset=TOKEN` URL parsing. Token is created and the reset URL works end-to-end **except** `sendResetEmail()` is a `console.log` stub. **Activation pending — see POST-LAUNCH-TODO #14.** Commit `56f9d15`.
A 4-digit PIN is easy to forget. With email + PIN as the only auth, a forgotten PIN = locked out forever. No "forgot PIN?" link on the sign-in screen.

**Fix:** add a "Forgot PIN?" link → email-based reset flow (send a one-time link → user sets a new PIN). Standard pattern.

**6. Login error has low contrast — "Invalid email or PIN" is hard to read.**
Pinkish-red on the translucent light-on-grass background. Doesn't meet WCAG AA contrast.

**Fix:** swap to a darker error color or a solid background pill behind the error text.

### LOW

**7. Onboarding progress bar shows 5 segments but step counter says "STEP X OF 4".**
The 5 segments include welcome (no step number) + 4 numbered steps. Mostly fine but momentarily confusing — a user on step 2 sees "STEP 2 OF 4" with 2.5 segments highlighted.

**Fix:** either change progress bar to 4 segments (welcome doesn't fill anything), or show "Step 1 of 5" on welcome and renumber.

**8. Coach-mark copy "AWAITING-tee-time" has weird capitalization.**
In the Welcome-Home tooltip on Home: "Match invites land here. Your live tee times and AWAITING-tee-time matches show up below the GolfNow card." That ALL-CAPS-HYPHEN-CAMEL is a code-token leaking into copy.

**Fix:** rewrite as "awaiting tee-time" or "tee-time-pending".

**9. Handle generation produces awkward results for non-traditional names.**
"E2E Test User" → "@euse" (first letter of first word + first 3 of last). Fine for "Matt Lavin" → "mlav", but odd for short / numeric / single-word names.

**Fix:** allow user to customize handle during onboarding (already a Display Name step — extend with a Handle field).

**10. Email persists when toggling Sign In ↔ Create Account.**
User types email on Sign In, clicks Create Account tab — email is still there. Could be intentional UX, but means a returning user who accidentally hits Create Account → submits → gets "email already exists" error.

**Fix:** detect if email already exists when toggling; if it does, switch back to Sign In with the email pre-filled and a soft "you have an account, sign in" hint.

**11. No loading state on auth submit.**
Click Sign In or Create Account, the button doesn't change state. 2-4 seconds of nothing visible. Users may double-click thinking the first click didn't register.

**Fix:** disable button + show spinner/"Signing in…" during the request.

### Investigative (not confirmed bugs)

- `GET /api/auth/me` returned 200 on a fresh page load AFTER localStorage was cleared. Either a cookie auth I missed, a stale-but-still-valid token elsewhere, or a quirk of the network log timing. Worth a 5-minute probe to confirm.

## Improvements (small-to-medium polish)

Loosely ordered: highest leverage first.

1. **Settings page** (paired with the no-logout bug). Gear icon top-right; signs out, manages notification prefs, links to privacy policy + delete-account, surfaces Vercel app version + last-updated.
2. **Forgot PIN flow.** Single highest-friction UX gap besides logout.
3. **App version visible somewhere.** Shows users the build is fresh; also helps debug "are you on the latest?" support questions.
4. **Tap-target audit.** Several buttons in the wizard look fine on the wide-mode rendering but the bottom-tab Eagle Eye button overlaps with the GolfNow CTA at certain heights. Worth a pass on iPhone hardware.
5. **Empty-state CTAs.** "Add a profile photo" sits in the Get Started 0/5 list — clicking it should open the profile editor with the photo upload already focused.
6. **Course name display.** Beyond fixing the truncation bug, consider showing course tier (championship / public / private) and number of holes (9 vs 18) where relevant.
7. **Bag completion flow.** Onboarding only adds the driver. After landing, "1 club · tap to manage distances" on the home card → likely opens a bag manager. Make this feel less skippable.
8. **Skeleton loaders** on tabs that hit the network (Tour leaderboard, course search, /me bootstrap). Currently shows a brief flash of empty UI.
9. **"Year in golf 2026" share-card** is intriguing — once a user has rounds logged, this should generate a polished story card. Worth designing the empty/early state explicitly.
10. **"Schedule a Tee Time"** banner visible on Home — confirm the action. If it's GolfNow integration, surface the affiliate logic transparently. If it's a coming-soon, label it.
11. **Inline validation feedback.** The driver distance field accepts any number; should soft-warn if outside reasonable range (e.g., <150 or >320 yds with "are you sure?" rather than blocking).
12. **First-name extraction for greeting.** "Hey, E2E." reads weirdly because "E2E" looks like an acronym. Consider stripping leading non-alpha characters or using full first word with a fallback.
13. **Match deletion swipe gesture** is mentioned in tooltips but not visually hinted. A subtle right-edge "swipe to dismiss" affordance on match cards would help discoverability.

## New ideas (bigger moves)

Tagged with rough leverage estimate (HIGH = drives DAU/retention, MEDIUM = nice unlock, LOW = nice-to-have).

### Engagement loops
- **Group chat per match (HIGH).** Per-outing thread with ribbing, score photos, side-bet calls. Currently `tm_outing_messages` exists per the schema but I didn't surface chat in the UI. If it's not shipped yet, prioritize.
- **Friends activity feed (HIGH).** "What your friends did this week" — rounds posted, achievements, course visits. The single biggest pull-back-to-app mechanism after social systems exist.
- **Streaks (MEDIUM).** Weekly play streak, monthly logged-rounds streak, course-collection streak. Notifications when a streak is at risk.
- **Achievements / badges (MEDIUM).** Already half-built (the "ACHIEVEMENTS" section says "Drop a birdie, post a sub-80 round, or play three rounds in a week — they unlock as you go"). Make this real.

### Match types
- **Tournament brackets (MEDIUM).** Multi-round knockout. Outings are currently single matches.
- **Side-bets framework (MEDIUM).** Skins, Wolf, Nassau, Bingo-Bango-Bongo as first-class match formats with auto-scored bets. The `tm_side_bets` table exists per migrations.
- **Wager-free "match dollars" ledger (MEDIUM).** Internal bragging-rights currency that settles per round. No real money so no compliance concerns.

### Eagle Eye depth
- **Caddie history (HIGH for power users).** "You hit 7-iron from 165 last time at Pebble — averaged 162 over last 10 swings." Eagle Eye remembers tendencies and recommends per-club.
- **Voice commands during round (HIGH for power users).** "Hey Eagle, 145 to the pin?" hands-free while playing — solves the gloves-on-camera-off-phone problem.
- **Course conditions overlay (MEDIUM).** Pin positions, wind, recent course condition reports. Live data layer on top of GPS.
- **Photo/video swing review (MEDIUM).** Record a swing, AI scores tempo / plane / impact position. Premium feature for The Match Elite tier.

### Social / sharing
- **Auto-generated story cards for big shots (MEDIUM).** "Eagle on #7 at Pebble" → polished social-share asset with course, hole, scorecard. One-tap to Instagram/X.
- **Course discovery map (LOW).** Map view, filter by distance / public-private / USGA rating. Beyond "search nearby."
- **Group leaderboard for league hosts (MEDIUM).** Public-link leaderboard for league standings, no login required to view (just to play).

### Platform
- **Apple Watch companion (MEDIUM).** Quick-glance distance + scoring on watch face. Small effort, big delight.
- **Native iOS/Android shells (HIGH for App Store).** PWAs hit a ceiling on background GPS, push notifications, deep-linking. Wrapping in a native shell solves multiple deferred items at once (background GPS for shot tracking, universal links for QR codes, App Store distribution).
- **Tee-time booking integration (MEDIUM).** Real GolfNow / Sagacity / 1Up Golf integration to book tee times in-app. The "Schedule a Tee Time" banner suggests this is on the roadmap.

### Practice + skill development
- **Practice mode (MEDIUM).** Track range sessions, putting practice. Drives engagement when no rounds are played.
- **Skill drills (LOW).** Game-ified practice routines with leaderboards. Bunker-out-of-3 challenge, 10-foot-putt streaks.

### AI coaching
- **AI Caddie chat (MEDIUM).** Conversational caddie advice during a round — already in the old POST-LAUNCH-TODO from prior sessions. "Hey Caddie, what club for 165 with 10mph headwind?" Already have Anthropic API wired up for Eagle Eye, so the bones are there.
- **Round debrief (LOW).** End-of-round AI summary: "You missed 6/14 fairways right today — let's adjust your driver alignment." Drives next-session intent.

## Cross-references

- `wiki/POST-LAUNCH-TODO.md` items #9 (Eagle Eye auto shot tracking), #11 (Privacy policy + delete-account), #12 (Sentry telemetry), #13 (Anthropic spend cap) — all still open and the right priorities. This audit's HIGH bug #1 (no logout) should join that list.
- `wiki/synthesis/audit-2026-04-29.md` — prior audit. That round closed all original items; this audit opens new ones from the live-fire of this session's E2E test.
- `wiki/synthesis/match-page-completion-plan.md` — the Outing/Match refactor is now closed (6/6 stages shipped 2026-05-04 → 2026-05-06).

## Recommended next-three-sessions

~~1. **Privacy + logout + delete-account** (POST-LAUNCH-TODO #11 + this audit's bug #1). All three are blockers for App Store submission, can be one Settings-page session.~~ ✅ DONE 2026-05-07 PM.
~~2. **Forgot-PIN + Settings page polish.** Adjacent to #1, completes the auth UX.~~ ✅ DONE 2026-05-07 PM (email send still stubbed — see POST-LAUNCH-TODO #14).
~~3. **Course name truncation root-cause.** Quick win that improves the perceived polish across the whole app.~~ ✅ DONE 2026-05-07 PM.

**Updated next-three (2026-05-07 PM):**

1. **Activate Forgot PIN emails** (POST-LAUNCH-TODO #14). Sign up for Resend (free 100/day), add `RESEND_API_KEY` to Vercel env, uncomment the marked block in `server/src/routes/auth.js`. ~30 min including signup. Closes the only remaining piece of audit bug #5.
2. **Polish-pass session for the remaining audit items** — MEDIUM #4 (onboarding wizard mobile-constraint), MEDIUM #6 (login error contrast), LOW #7-#11. None are App-Store blockers but they all sand off rough edges users see. Estimated 1-2 hours total.
3. **Choose between engagement-loops or Eagle Eye depth** for a feature session — see new-ideas list above. Today's `first_birdie` work proved the achievement-expansion pattern is cheap; that's a reasonable warm-up for either direction.

The App Store submission has no remaining code blockers as of 2026-05-07 PM. The remaining work is polish + new features.


============================================================================
=== SOURCE PAGE: match-page-completion-plan.md
============================================================================

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
