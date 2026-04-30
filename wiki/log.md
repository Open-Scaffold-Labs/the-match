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

