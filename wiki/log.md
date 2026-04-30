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


