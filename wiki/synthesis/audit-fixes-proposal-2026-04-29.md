---
type: synthesis
created: 2026-04-29
updated: 2026-04-29
tags: [audit, fixes, the-match, approval-queue]
---

# The Match — Audit Fixes Proposal (2026-04-29)

> Concrete fix proposals for every bug + UX issue from `audit-2026-04-29.md`. Each proposal includes file path, exact diff or precise change description, test plan, and risk level. **No app code has been changed yet — this is a proposal awaiting Matt's approval.** Approve individual items or the full set; I'll execute in order.

## Approval queue (TL;DR table)

| # | Bug | File | Risk | Effort | Recommend |
|---|---|---|---|---|---|
| **F-R3** | Tee selector duplicates | `client/src/pages/EagleEye.jsx:766` | Low | 5 min | ✅ approve |
| **F-R4** | Home/Stats handicap inconsistency | `client/src/pages/Stats.jsx:197` | Low | 10 min | ✅ approve |
| **F-R8** | "Integration coming soon" stub copy | `client/src/pages/Home.jsx:1738` | Low | 2 min | ✅ approve |
| **F-R7** | "RD 0" pre-tournament label | `client/src/pages/PGAScores.jsx:312` | Low | 5 min | ✅ approve |
| **F-B1** | CLAUDE.md feature status stale | `CLAUDE.md` (the-match repo) | Low | 5 min | ✅ approve |
| **F-B7** | 57 production console.log | 6 client files | Low | 15 min | ✅ approve |
| **F-R5** | Background contrast (Stats + Tour) | `Stats.jsx`, `PGAScores.jsx` | Low | 10 min | ✅ approve |
| **F-B11** | No React error boundary | `client/src/main.jsx` (new file) | Low | 15 min | ✅ approve |
| **F-R2** | Modals escape mobile container | `client/src/pages/EagleEye.jsx` (multiple portals) | Medium | 20 min | ✅ approve |
| **F-R1** | Match tab buttons overlap | `client/src/pages/Outing.jsx` (Hub view) | Medium | 15 min | ✅ approve |
| **F-R6** | Tee-time entries indistinguishable | `client/src/pages/Home.jsx` + maybe schema | Medium | 30 min + DB migration | ⚠ discuss |
| **F-B3** | Token in URL fragment | `client/src/App.jsx:24` | Low | 5 min | ✅ approve |
| **F-B5** | Rate-limit auth endpoints | `server/src/routes/auth.js` + `server/package.json` | Medium | 20 min | ✅ approve |

**Deferred (need bigger conversation):**
- F-U1 Split Outing.jsx + Home.jsx (1500+ lines each)
- F-B8 Add React Router
- F-B4/B6 Auth security overhaul (HttpOnly cookies + 6-digit PIN or OAuth)
- F-T1 Test suite

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
