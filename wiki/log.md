---
type: overview
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Activity Log

Chronological, append-only. Every entry starts with `## [YYYY-MM-DD] <op> | <label>` where `<op>` is one of `ingest`, `query`, `lint`, `refactor`, `schema`.

## [2026-04-30] refactor | Match page perfection — 4-phase rebuild

After light-theme conversion, Match page still had information-design gaps. Critique surfaced 7 specific issues; this pass closes them all.

**Phase 1 — content density:**
- `/api/outings/recent` enriched: now returns `opponent_names[]`, `created_at`, `updated_at` (subquery over `tm_outing_participants` filtered to `user_id <> $1`).
- New `<RecentMatchCard />` reads "You vs Dale" / "You vs Dale & Chris" / "You vs Dale +2" instead of repeating the boilerplate match name.
- `relDate(iso)` helper produces "Today / Yesterday / Mon / Mar 12" labels.
- `copyCode(code)` async helper with `navigator.clipboard.writeText` + textarea fallback for older browsers and iOS PWA.
- Tap-to-copy code chip with 1.4s `✓ Copied` confirmation flash.
- `EmptyRivalries` collapsed from 200px card to 40px one-liner.

**Phase 2 — Live Now strip:**
- New `<LiveMatchCard />` promoted ABOVE primary CTAs when any match has `status === 'active'`.
- `.tm-live-pulse` keyframe in `tokens.css` — 1.6s opacity+scale loop.
- Header copy adapts: "You have 2 matches in progress." vs default subtitle.
- Live cards use green-tinted gradient (`rgba(46,158,69,0.18)` → `rgba(255,255,255,0.85)`) to differentiate from regular cards without going dark-on-dark.
- `Recent Matches` now filters to `status !== 'active'` (no double-rendering).
- LIVE cards capped at `MAX_LIVE = 3` with `+ N more in progress` expand link to prevent stale-data tail dominating the page.
- "You vs <match name>" bug fixed: when `opponent_names` is empty, title falls back to `o.name` and a `Waiting for players` chip renders instead of awkward "You vs Matt Lavin's Match".

**Phase 3 — CTA hierarchy:**
- Solo Round + Leaderboard demoted to thin icon-pill row (~30px tall vs ~50). Smaller text, smaller icons, lighter background.
- Reclaims ~40px vertical for actual match content.
- "+ Create" stays the dominant primary action.

**Phase 4 — polish:**
- Search input appears next to "Your Rivalries" header at `rivalries.length >= 5`.
- "No rivalries match 'X'" empty state for filtered search.
- Course pin icon on cards once `course_name` is set.

**Files touched:** `server/src/routes/outings.js`, `client/src/pages/Outing.jsx`, `client/src/design/tokens.css`. No schema changes. No Eagle Eye changes (preserved the careful work from 2026-04-29).

**Commits:** `f23ea41` (initial 4-phase rebuild), `49c2680` (cap + "Waiting for players" fix). Both deployed to Vercel via `vercel --prod --yes` after each commit (auto-deploy still broken, see open todo).

## [2026-04-30] refactor | Augusta Scoreboard — surface + perfect Masters replica

User feedback: "i thought we built the augusta scoreboard for the match page" — the previous Match-page refactor demoted Leaderboard to a tiny icon button. Then: "it needs to replicate it perfectly" — the board itself was white-on-white, didn't actually look like Augusta. Then: "make the board take up the whole page too" — the board only filled the top half with empty green space below.

**Phase A — Match-page hero card:**
- Replaced the demoted Solo Round + Leaderboard icon row with a full-width Augusta-themed hero card.
- Forest green (#0F3D1E → #1a5c1a) gradient with gold M-flag emblem on the left, italic Georgia "Augusta Scoreboard" title, gold subtitle, and "Open →" affordance in gold.
- Subtle wood-grain stripes via `repeating-linear-gradient`.
- Solo Round demoted to a smaller secondary pill below the hero.

**Phase B — perfect Augusta board replica (`AugustaBoard.jsx`):**
- Body color: forest green (`#0F3D1E`) with deeper-green panel cells (`#0a2c14`) — was cream/parchment.
- "LEADERS" header: gold block letters on green with text-shadow (was black on white).
- HOLE row: white block letters on green (was black).
- PAR row: gold/yellow numerals on green — the iconic Masters detail (was black on white).
- Player rows: green panel for PRIOR + NAME + F9/B9/TOT columns. Player surname only, in white block-letter caps (real Masters board shows surnames not full names). Current user gets a 4px gold left-border accent and a slightly-lighter green row tint.
- Score cells: cream tiles (`#F4E9C1`) with thick black borders, red numerals for under-par (`#B22222`), ink for over-par (`#0F0F0F`). Birdie = single red circle, eagle = double red circle. Bogey = single black square, double = double square.
- Added F9 / B9 / TOT columns at the right (real Masters board has these; previous version was missing). Round total is gold and bigger.
- Removed the photo column (real Augusta board has no player photos).
- Wood-frame border (`#5a3a16`) around the entire board with deep `box-shadow`.
- Footer: gold "Augusta National Club Golf" italic on dark plaque with M-flag bookends.
- Add Player UI moved INSIDE the board frame, just above the footer — gold-on-deep-green so the entire board reads as one cohesive framed unit. Cream input field with gold border, gold "+ ADD PLAYER" button.

**Phase C — fill the whole page:**
- Outer wrapper: `display: flex, flexDirection: column, minHeight: 100dvh`.
- Board container: `flex: 1` to grow into the available viewport.
- Scrollable grid inside the board: `flex: 1` so the table fills the panel.
- Added 8 placeholder rows with cream-tinted score cells so the empty state reads as a real Masters board with open slots, not a half-empty grid.
- "Add a player ↓" italic gold hint in the first empty row when no players yet.
- Now the board reaches from the top of the viewport down to just above the bottom nav, with the Add Player input + Augusta plaque pinned to the bottom of the frame.

**Verified live by adding "MATT LAVIN", entering 3 (birdie) on hole 1 par 4, 8 (double bogey) on hole 2 par 5, 4 (par) on hole 3.** PRIOR column correctly shows `+2`. Red circle around the 3, double black square around the 8, no marker on the 4. All visual indicators working.

**Commits:** `ab0229b` (initial replica), `125e47b` (full-page fill + Add Player inside frame). Touched: `client/src/components/AugustaBoard.jsx`, `client/src/pages/Outing.jsx`. No schema, no Eagle Eye changes.

## [2026-04-30] refactor | Augusta board color correction (teal-sage, not forest green)

User shared a photo of the actual Masters scoreboard. The iconic Augusta panels are **pale teal-sage** (#A8C9C2), not forest green as I had built. Text on the panels is **black**, with red for under-par scores. Forest green is reserved for the wooden frame and the F9/B9/TOT divider strips.

**Color corrections in `AugustaBoard.jsx`:**
- Panel background: forest green → `MASTERS_TEAL #A8C9C2` (PRIOR, NAME, HOLE row, PAR row, empty placeholder rows)
- Player surname text: white → `MASTERS_INK #0F0F0F`
- PRIOR (score-to-par): gold/white → black for over-par, red for under
- PAR row numerals: gold → black on teal — the real board's iconic detail
- HOLE row numerals: white → black on teal
- F9/B9/TOT divider strips: still dark green with white numbers (matches the green dividers on the reference photo)
- LEADERS banner: gold-on-green → dark-green-on-cream (the real board has a cream/tan arched banner with dark green letters)
- Score tiles: warmer cream `#F2EBD3` (was `#F4E9C1`)
- Empty placeholder rows: teal panels with the cream tile slots
- 'Add a player ↓' hint: gold → dark ink (now readable on teal)
- Add Player section: gold-yellow gradient → simple teal button on dark-green strip (feels like the operator panel area at the back of a real roller board)
- Footer plaque: still dark green, but text now white (was gold) to match the cream-banner-on-green color logic of the rest of the board

**Commit:** `1b24a77`. Touched: `client/src/components/AugustaBoard.jsx`. No new dependencies.

## [2026-04-30] refactor | Path A — Augusta is the only scorecard

User direction: "this needs to be the scorecard for every match you enter, it shouldnt have its own button it should be the only scorecard and the size of the rows can be a minimum of 4 rows that fit the screen if its a match of only 4 or less".

Two paths considered. Picked **Path A** (Augusta visuals on `LiveOuting`, retire standalone `AugustaBoard`). Path B would have rebuilt scoring from `AugustaBoard` and ported all the server logic — too much regression risk for purely visual gain.

**LiveOuting + ScorecardTable + TotalsRow restyled:**
- Page background: dark forest green gradient (was transparent)
- Header strip: dark green with white italic title and gold code chip
- Wood-frame panel wrapping the scorecard with cream `LEADERS` banner
- HOLE / PAR rows: black numerals on pale teal panel (`AUGUSTA_TEAL #A8C9C2`)
- Player rows: white block-letter SURNAME caps on teal; current user gets a gold left-border accent
- Score cells: cream tile (`AUGUSTA_TILE #F2EBD3`) with red numerals for under-par, ink for over; birdie = single red circle, eagle = double; bogey = single black square, double = double square
- Subtotal columns (OUT / IN): dark green strip with white block letters
- TOTALS strip: dark green panel with white SURNAME, white TOT/+/-/THRU; gold for under-par, light red for over
- Match-play winning cells: light gold tile w/ green border; losing: light red tile w/ red border; halved: dashed border
- Augusta plaque footer with M-flag bookends

**Row sizing (the user's "min 4 rows that fit the screen" requirement):**
- `MIN_ROWS = 4`. When the match has ≤4 players, real rows render at 80px and the table appends `4 - participants.length` filler placeholder rows (teal panel + cream tile slots) so the board always shows 4 rows.
- When the match has >4 players, rows shrink to 56px and the body scrolls vertically.
- Avoids stretching a single LAVIN row to 180px tall (looked terrible).

**Add Player modal — search-as-you-type:**
- Type 2+ chars → debounced 250ms call to `/api/friends/search?q=…`
- Matching app users render as a tappable list with name + email + handicap; click to bulk-join via `/api/outings/:code/bulk-join`
- "Add as guest" button always available — falls back to the original `/guests` endpoint for players without an account
- Fixes the previous behavior where the only path was manual guest entry

**Removed:**
- `AugustaBoard` import (`from '../components/AugustaBoard.jsx'`) — the file still exists but is no longer wired up
- The standalone `view === 'board'` route in the main `Outing` wrapper
- The Augusta Scoreboard hero card on the Match tab
- The `onLeaderboard` prop wiring through `OutingHub`

**Color constants extracted to module level** at the top of `Outing.jsx` (`AUGUSTA_GREEN`, `AUGUSTA_TEAL`, `AUGUSTA_CREAM`, `AUGUSTA_TILE`, `AUGUSTA_RED`, `AUGUSTA_INK`, `AUGUSTA_WOOD`, `AUGUSTA_GREEN_DEEP`, `AUGUSTA_TEAL_HOVER`).

**Commits:** `fbe1774` (initial Path A), `825ae55` (filler-rows fix). Touched: `client/src/pages/Outing.jsx`. No schema, no Eagle Eye, no server changes (server already had `/api/friends/search` and `/api/outings/:code/bulk-join`).

## [2026-04-30] refactor | Profile pictures on the Augusta scorecard

User wanted player photos on the scorecard alongside the surname caps.

**Server change** — `/api/outings/:code` now enriches each non-guest participant with `u.avatar` (data URL) from `tm_users`. Guests don't have avatars (they have no account); they get the initials fallback.

**Client change** — new `<PlayerAvatar />` component in `Outing.jsx`:
- Renders an `<img>` of the user's uploaded photo when `avatar` is set
- Falls back to initials on a deterministic background color (same palette as the original AugustaBoard helpers — `#1B5E20`, `#0D47A1`, `#6A1B9A`, etc.)
- Configurable size + ring color so it can be themed differently in `ScorecardTable` (white-ish ring on teal panel) vs `TotalsRow` (gold ring on dark green strip)

**Layout adjustments:**
- `PLAYER_COL` bumped from 90 → 116 to fit the avatar + surname inline without truncation
- Avatar size auto-scales with `rowH` (capped at 36px) so larger row heights for ≤4-player matches show bigger photos
- Current user's avatar still gets the gold ring + the row's gold left-border accent

**Verified live** — joined a match, saw the LAVIN row with my actual profile photo to the left of the surname; entered scores 5 (bogey, black square), 3 (birdie, red circle), 6 (double, double square), 2 (eagle, double red circle), 4 (par, no marker). All markers + colors firing correctly.

**Commit:** `215cd2d`. Touched: `server/src/routes/outings.js`, `client/src/pages/Outing.jsx`. No schema (avatar/cutout columns already existed in `tm_users`).

## [2026-04-30] schema | Real per-hole pars from a course picker (closest-first)

User direction: "i want the hole number and par for the hole information show exactly what the course your playing is" — they want the actual pars for the course being played (not the synthetic 4/3/5 distribution from `estimateHolePars`). Then: "full picker but make courses closest to you start showing up first after you type first two letters".

**Migration `006_tm_outing_course_data.sql`** — applied to production Supabase. Added five nullable columns to `tm_outings`:
- `course_id INT` — GolfCourseAPI course ID
- `course_tee TEXT` — name of the chosen tee (Black, White, etc.)
- `hole_pars JSONB` — array of pars per hole
- `hole_yardages JSONB` — array of yardages per hole
- `hole_handicaps JSONB` — array of stroke indices per hole

**Server changes:**
- `POST /api/outings` accepts `courseId`, `courseTee`, `holePars`, `holeYardages`, `holeHandicaps` and stores them; legacy create calls without these fields still work (columns are nullable).
- `GET /api/outings/:code` already used `SELECT *` so the new fields flow through automatically.
- `/api/courses/search` accepts `?lat=Y&lng=Z`. When provided, computes Haversine great-circle distance to every result and sorts ascending (unknown distances go last). Falls back to API order without coords.

**Client changes (`Outing.jsx`):**
- New `<CoursePicker />` component replaces the free-text "Course name" input in CreateWizard step 0:
  - Requests browser geolocation silently on mount; passes coords to search if granted (so closest courses appear first per the user's request)
  - Debounced 250ms search after 2+ chars hits `/api/courses/search`
  - Results render with city/state and distance (auto-formatted: meters / km / rounded km)
  - Click a course → loads `/api/courses/:id` → tee selector renders with `par_total`, `total_yards`, `course_rating/slope_rating` per tee
  - Click a tee → captures full `hole_pars`/`hole_yardages`/`hole_handicaps` and shows "✓ Pebble Creek Golf Course / Black tees · Par 71 · 18 holes" with a Change button
  - Free-text fallback retained: "Can't find it? Just leave the name typed — we'll use your course name without the per-hole pars."
- `LiveOuting` now prefers `outing.hole_pars` (sliced to the match's hole count). Falls back to `estimateHolePars(coursePar, holeCount)` for legacy matches with no real data.

**Verified live** by creating a fresh match with Pebble Creek Golf Course → Black tees:
- Header reads "Pebble Creek Golf Course · Par 71" (was "TBD · Par 72")
- PAR row shows the real Pebble Creek Black-tee distribution: Front `4-4-4-4-4-3-4-3-5`, Back `4-3-5-3-4-5-3-4-5`
- Augusta scorecard birdie/bogey markers continue to compute against these real pars
- Geolocation in Chrome MCP wasn't granted so distance sort wasn't visible in the UI — graceful degradation worked (results came back in API order)

**Commit:** `50fbcbe`. Touched: `migrations/006_tm_outing_course_data.sql`, `server/src/routes/courses.js`, `server/src/routes/outings.js`, `client/src/pages/Outing.jsx`.






