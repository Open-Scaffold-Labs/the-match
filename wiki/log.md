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

## [2026-04-30] refactor | Scoreboard late-night polish marathon

Major aesthetic overhaul of the in-match scoreboard (LiveOuting + ScorecardTable + TotalsRow). Captured here as one entry; individual commits below.

**Premium tournament-board redesign** (`0a3997f`) — replaced the teal panel scheme with deep forest green panels, white block-letter HOLE row, gold PAR numerals, cream score tiles with inset shadows, embossed cream LEADERS plaque with gold rules, wood frame with gold pinstripe.

**Border / alignment cleanup rounds** (`167b1bc`, `fd2e484`, `bbee166`, `7c910e4` reverted, `3e4265f`, `56b0dad`, `76625f6`, `509cc4e`):
- Switched cell borders from full `border` (caused 2px between body cells vs 1px between header cells) to `borderLeft`-only so dividers run continuously through every cell.
- Unified score cell bg to solid cream everywhere (was `rgba(...,0.55)` over a green gradient = murky olive that read as "row ran out").
- Subtotal cells (OUT/IN) matched body color to header color (`AUGUSTA_GREEN_DEEP` everywhere) so the rightmost column reads as one continuous strip.
- Removed the `inset 0 -1px 0` bottom highlight that was making score cells look 1px taller than subtotal cells next to them.
- Each row now uses `width: max-content + minWidth: 100%` so the row's `borderBottom` spans the full content width, not just the visible scroll-container width — fixes the "lines cut off mid-row" bug after the avatar column was added.
- Restored `cellBorder()` helper that ScoreModal still referenced (regression).

**Tier-1 polish** (`c090480`):
- New leftmost RANK_COL with leaderboard position (1, T2, 3…). Leader's badge gets a gold gradient.
- Leader gold highlight on the surname (was just gold for current user).
- THRU subtitle ("THRU 7" / "F") under the player's surname instead of buried in the bottom totals row.

**Tier-2 polish** (`c6b2537`):
- Wood-grain texture on the frame (vertical repeating-linear-gradient grain lines + highlights over a brown gradient).
- Active-hole flag pin (small gold-flag SVG) sits on the HOLE row over the next-to-be-played hole.
- Match-play status banner promoted from inside the header to a prominent broadcast-style banner above the wood frame.

**Tier-3 polish** (`6f8ff99`):
- Score reveal animation — every score numeral wrapped in a span keyed by `score+par`. When score changes, React remounts → triggers `tm-score-reveal` keyframe (380ms scaleY 0.10 → 1.15 → 1.0 with bounce). Mimics manual-flip Masters scoreboard.
- Recent-event banner — when `saveScore` lands, a gold-or-green pill pops down for 4s with the player surname, score label (EAGLE/BIRDIE/PAR/BOGEY/DOUBLE), and hole number.

**Tap hint + instruction removal** (`d18e06b`):
- New `findTapHint()` walks sorted players to find the first empty cell the current user can edit. Returns null once any score has been entered.
- `tm-tap-hint` keyframe pulses a 2px gold inset ring + outer gold glow on the matched cell so first-time users know where to tap.
- Removed "Tap any cell to enter scores" instructional copy from the host-controls row — the pulsing cell teaches the same thing.

**Color swap + translucency experiments** (`ddbc0bf`, `651dcd2`, `f2ce728`, `ca40c78`):
- Green→white panel swap, white→green text swap.
- AUGUSTA_TEXT bumped to a richer #1A6B28.
- All AUGUSTA panel surfaces moved to rgba alphas (0.55–0.65) so the page fairway grass shows through. Cream tiles + wood frame translucent too. Backdrop-filter blur(10px) on the inner board for glass-morphism. `LiveOuting` page bg switched from dark green gradient to transparent so the fairway image is the new backdrop.

**Bug fixes from feedback**:
- `49c2680` — "You vs Matt Lavin's Match" string (when no opponents have joined): show "Waiting for players" subtitle instead.
- Scrolled-right border misalignment: unified body + header cells to share borderLeft pattern.
- LiveOuting header clipping behind iOS notch: `padding: calc(var(--safe-top) + 14px)` so it clears the safe-area-inset.

**Session commits (15+ total today)**: `0a3997f` `167b1bc` `fd2e484` `bbee166` `3e4265f` `56b0dad` `76625f6` `509cc4e` `c090480` `c6b2537` `6f8ff99` `d18e06b` `ddbc0bf` `651dcd2` `f2ce728` `ca40c78` and supporting wiki/log entries.

**Files touched**: primarily `client/src/pages/Outing.jsx` (the LiveOuting + ScorecardTable + TotalsRow) and `client/src/design/tokens.css` (3 new keyframes: `tm-score-reveal`, `tm-event-pop`, `tm-tap-hint`). No schema changes. No Eagle Eye changes.


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

## [2026-04-30] refactor | PlayerCard: match the Tour-page PGA photo style exactly

User direction: "i want the photo generator for users to give that exact same look... right now the flags are diagonal with a white shade at the bottom and name and i dont want that, i want it to look exactly like how the actual pga players pictures look on the tour page".

Reference look — `PlayerPhoto` in `PGAScores.jsx` is a faded full-cover country flag (`opacity: 0.18`) with the headshot layered on top, top-aligned. Nothing else. Mirrored that treatment in the avatar generator:

**`PlayerCard.jsx` — flag definitions:**
- Each entry now carries an ISO code (`us`, `gb-eng`, `gb-sct`, `jp`, `fr`, `kr`, etc.) instead of a stripe-color array.
- New `flagUrl(iso)` helper returns `https://flagcdn.com/w1280/<iso>.png` — CORS-enabled, supports subdivisions like `gb-eng` and `gb-sct` for England/Scotland.

**`buildCard` rewritten:**
- Cream base for any flag transparency
- Country flag image, full-cover, drawn at `globalAlpha: 0.22` via a new `drawCover(ctx, img, x, y, W, H)` helper that mirrors CSS `object-fit: cover` (centered crop). Falls back to solid accent color at 0.16 if the image fails to load.
- Player cutout, full-canvas height, top-aligned (mirrors `objectPosition: top center`)
- **Removed:** `drawFlagBg` (diagonal parallelogram stripes), the cream info-panel gradient, the accent line + glow, the country-name overlay, the player-name overlay, the handicap/course/wins-losses stats row, and the `THE MATCH` watermark.
- Card output is now: faded country flag + player cutout. Nothing else. Same compositional DNA as the Tour-page `PlayerPhoto`, just bigger.

**Mini flag preview in `CustomizeScreen`:** swapped from canvas-drawn diagonal stripes to a real `<img>` from `flagcdn.com/w80/<iso>.png` so the picker tile matches what gets composited onto the actual card.

**Backwards compat:** `buildCard(cutoutBlob, flag, profile)` keeps the old 3-arg signature (profile is ignored). Saved data URL still flows through `POST /api/profile/avatar` unchanged. Existing saved cards continue to work; users hit "Retake Photo" to regenerate in the new style.

**Commit:** `2796766`. Touched: `client/src/components/PlayerCard.jsx` (91 insertions / 152 deletions — net smaller).

## [2026-04-30] refactor | Scorecard avatar in its own filled box

User feedback: "i want the users pictures to have their own box to the left of the box their name is in so they arent scrunched together... make the picture fill out the box so adjust the size of the box the pictures go in accordingly".

Previously each player row in `ScorecardTable` and `TotalsRow` had a single combined cell of width `PLAYER_COL = 116` containing a 30-36px circular `<PlayerAvatar />` next to the surname (gap: 8). The avatar was small and the name was crammed.

**Split into two real cells:**
- `AVATAR_COL = 60` — square box; `<img>` fills edge-to-edge with `objectFit: cover` + `objectPosition: top center` (preserves the head on portrait PGA-style avatars). Initials fallback also fills the box edge-to-edge with a deterministic palette color.
- `NAME_COL = 88` — surname only, comfortably wide
- `PLAYER_COL = AVATAR_COL + NAME_COL = 148` — kept around so headers (FRONT 9 / PAR / TOTALS / BACK 9) span both cells visually with one combined cell.
- A vertical `1px solid AUGUSTA_GREEN_DEEP` divider separates the avatar cell from the name cell so the column structure reads clearly.

**Affected rendering paths:**
- ScorecardTable body player rows
- ScorecardTable filler placeholder rows (keep the same column geometry so things align)
- TotalsRow player rows (avatar fills the dark green strip; ring is gone since the cell border replaces it)

**Header rows (HOLE / PAR / TOTALS) untouched** — they still use one combined cell at `PLAYER_COL` width, which still equals the sum of the body's two cells. The columns line up.

**Current-user gold accent preserved** — the 4px gold left-border now lives on the avatar cell (the leftmost thing in the row); the cell width shrinks 4px when `isMe` so total row geometry still matches the header.

**Verified live** — the LAVIN row now shows the user's actual PGA-style portrait card filling its avatar box, with "LAVIN" surname and score cells flowing cleanly to the right. Filler rows render empty avatar + empty name cells preserving the layout.

**Commit:** `59fd7ed`. Touched: `client/src/pages/Outing.jsx`.

## [2026-04-30] refactor | Scoreboard premium tournament-board redesign

User feedback: "im not crazy about the teal color, there is no teal color on the actual augusta scoreboard.... page looks a little cheap, i want it to really impress visually". The earlier teal palette had been a misread of an off-tournament reference photo — the iconic in-tournament Augusta board is forest green with white block letters and gold PAR numerals.

**Palette overhaul:**
- `AUGUSTA_PANEL = #1A5230` (forest green) replaces `AUGUSTA_TEAL #A8C9C2`. Old `AUGUSTA_TEAL`/`AUGUSTA_TEAL_HOVER` constants kept as aliases so any stragglers still work.
- `AUGUSTA_PANEL_HI = #235C36` for the panel-gradient top stop.
- `AUGUSTA_GOLD = #E8C05A` (PAR numerals + accent) and `AUGUSTA_GOLD_DIM = #A8862E` (pinstripe / dimmed gold).

**Header rows (HOLE / PAR):**
- Switched from `flat teal + black text` to `panel gradient + white block-letter HOLE numerals with text-shadow` (chiseled feel) and `gold PAR numerals` — the iconic Masters detail.
- Header height bumped 32 → 34 px to give the bigger letterforms breathing room.

**Player rows:**
- White surname caps on the same panel gradient, with `0 1px 1px rgba(0,0,0,0.45)` text-shadow for embossed feel.
- Current-user accent: 4px solid `AUGUSTA_GOLD` left-border (was solid forest green) — actually pops as "this is you".
- Avatar cell sits on `AUGUSTA_GREEN_DEEP` with a subtle inner highlight so the player photo really stands out against the dark slot.

**Score tiles:**
- Cream tiles get a `inset 0 1px 2px rgba(0,0,0,0.18), inset 0 -1px 0 rgba(255,255,255,0.40)` box-shadow — mimics the slotted-into-the-wood feel of real Masters score cards.
- Subtotal cells (OUT / IN / TOT) get a deeper `inset 0 1px 2px rgba(0,0,0,0.50)` since they sit on the dark green strip.

**LEADERS plaque:**
- Cream → darker-cream gradient with `inset 0 -1px 2px rgba(0,0,0,0.18)` for embossed feel.
- Thin gold rules above and below the type (`top: 0` and `bottom: 4` absolute-positioned 1px strips) in `AUGUSTA_GOLD_DIM` at 0.55-0.7 opacity.
- Type switched from Impact to Georgia serif, letter-spacing widened from 0.16em → 0.20em for a refined look. Text-shadow adds depth.

**Wood frame:**
- Outer drop-shadow `0 16px 50px rgba(0,0,0,0.55)` for floating-on-the-page weight.
- Inner gold pinstripe ring (`inset 0 0 0 1px AUGUSTA_GOLD_DIM`) inside the wood, then a deeper inset dark ring for hand-painted-wood grain.

**Filler placeholder rows** match the new panel gradient + deep-green avatar slots so the empty-state board still reads as a tournament board.

**Verified live** — opened Pebble Creek match at Black tees:
- LEADERS plaque reads as an embossed cream sign with gold rules
- HOLE 1-9 in white, PAR 4-4-4-4-4-3-4-3-5 in gold
- LAVIN row with gold left-border, white surname, photo in deep-green slot
- Score 3 on hole 3 (birdie on par 4) shows red numeral + red circle on cream tile
- Footer plaque with M-flag bookends reads correctly

**Commit:** `0a3997f`. Touched: `client/src/pages/Outing.jsx` (palette constants + ScorecardTable headers + body + filler rows + ScorecardCell box-shadow + LiveOuting board frame + LEADERS plaque). 91 insertions / 49 deletions.

## [2026-05-01] refactor | Audit fixes proposal closed out — bookkeeping pass

Started the session intending to work the audit fix queue from `wiki/synthesis/audit-fixes-proposal-2026-04-29.md`. Discovered the entire "Recommended for immediate execution" list (12 items) plus the "Discuss before executing" item (F-R6) had already shipped on 2026-04-29 PM, but the wiki page still read as a proposal awaiting approval. Bookkeeping was stale — exactly the kind of state-mismatch anti-pattern that misleads future Claude sessions.

**Updated `wiki/synthesis/audit-fixes-proposal-2026-04-29.md`:**
- Changed status to `closed` in frontmatter
- Added a "CLOSED — all queued items shipped" header at the top with the three shipping commit refs (`1fa6ee4`, `8d74a76`, `93053ba`)
- Rewrote the TL;DR table: replaced the "approve" column with a "Status / Commit" column showing each item shipped
- Added F-R6A (legacy-row "#N of M" fallback) as its own row since it shipped autonomously
- Added a "Bonus shipped in autonomous batch" subsection (F-U3, F-B9, F-T7, F-T5, plus F-U5 + F-U10 discovered already done)
- Re-listed deferred items, with U1 explicitly flagged as **getting worse**: Outing.jsx grew 2,020 → 3,324 lines after the scoreboard / Augusta-board / Match-page rebuilds all landed inside the monolith
- Restated still-open items from the full audit that were NOT in the original proposal (B2/B10/B12, U2/U4/U6/U7/U8/U9/U11, T2/T3/T4/T6/T8/T9/T10, all F1-F14)
- Body of the original proposal preserved as historical record

**Updated `wiki/synthesis/audit-2026-04-29.md`:**
- Added a status header at the top noting most of the priority list shipped, with a forward-pointer to the proposal page for commit refs
- Re-marked the "Updated priority list (after runtime findings)" section: R1-R8 + B1/B7/B5 struck through with shipped commits; U1 / B8 / F2 / F8 still bolded as open
- Re-marked the "Recommended priority" section: items 1-3 struck through, items 4-5 (U1, B8) bolded as open
- Body of the audit unchanged (it's a historical snapshot)

**Important correction discovered:** an earlier read of the audit-fixes-proposal page implied U1 (split Outing.jsx + Home.jsx) might have shipped given all the recent scoreboard work in `Outing.jsx`. Verified by `wc -l client/src/pages/*.jsx`: no `Outing/` or `Home/` subdirectories exist, all the scoreboard / Augusta-board / Match-page rebuilds went *into* the existing monoliths. Outing.jsx grew from 2,020 → 3,324 lines (+1,304); Home.jsx 1,872 → 1,932; EagleEye.jsx 1,457 → 1,508. U1 is more urgent now than at audit time.

**Files touched:** `wiki/synthesis/audit-fixes-proposal-2026-04-29.md`, `wiki/synthesis/audit-2026-04-29.md`, `wiki/log.md`, `wiki/index.md`. No code changes. Next step: scope U1 properly as its own focused session.







## [2026-05-01] schema | end-of-session: onboarding triad shipped, tile-grid open

- Onboarding wizard (mandatory 5 steps) gates app access until step 4 (driver added). Lives at `client/src/components/OnboardingWizard.jsx`.
- Home checklist (`OnboardingChecklist.jsx`) and per-tab CoachMark primitive both shipped. Coach marks active on Home, Match, Eagle Eye, My Bag, Profile, PlayerCard.
- Admin gear icon on Home (gated on `tm_users.role = 'admin'`) opens `AdminUsersModal.jsx` showing all signups newest-first.
- Migration 012 added `onboarding_completed_at`, `onboarding_steps`, `coach_marks_seen`, and promoted Matt's account to admin. Migrations 009-011 also applied earlier in the session for bag inventory + per-club distance + outings.expected_players.
- Bag picker on Eagle Eye fully working: AI club recommend + ▲/▼ toggle + projected pulsing yellow landing target along aim line.
- Tour page fixed for new ESPN scoreboard payload shape.
- Match page swipe-left-to-delete on host's own active matches.
- Wizard now asks for # of golfers (`expected_players`).

**Open issue**: satellite tiles in Eagle Eye show visible grid lines after 5 CSS attempts (container bg, transparent outline, scale 1.01, GPU compositing, will-change). Likely root cause = leaflet-rotate plugin sub-pixel transforms. Full triage + ranked next steps in `wiki/synthesis/eagle-eye-tile-grid-handoff-2026-05-01.md`. Don't re-attempt the fixes already in `EagleEye.jsx`.
