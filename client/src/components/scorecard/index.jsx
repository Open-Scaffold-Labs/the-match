// ─── components/scorecard/ — the ONE shared scorecard surface (S4, 2026-07-06) ──
// Extracted verbatim from pages/Outing/LiveOuting.jsx as slice S4 of the
// solo/multi scorecard unification (spec: wiki/synthesis/solo-multi-scorecard-
// unification-spec-2026-07-06.md). Both consumers — LiveOuting (multi) and
// ActiveRound (solo) — import from here; neither owns these components anymore.
// Defensive default props added in this move (playerTeam, diffStr/netDiffStr
// value-or-fn) so a consumer wiring plain values instead of per-player
// functions degrades gracefully instead of crashing — the two prop-contract
// crashes of 2026-07-06 are the motivation.
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { courseHandicap, playerTeeRatings } from '../../lib/handicapClient.js'
import { scoreColor as scoreToParColor } from '../../lib/scoreColors.js'
import {
  AUGUSTA_GREEN, AUGUSTA_GREEN_DEEP, AUGUSTA_PANEL, AUGUSTA_PANEL_HI,
  AUGUSTA_PANEL_HOVER, AUGUSTA_TEXT, AUGUSTA_GOLD, AUGUSTA_GOLD_DIM,
  AUGUSTA_CREAM, AUGUSTA_TILE, AUGUSTA_RED, AUGUSTA_INK, AUGUSTA_WOOD,
  avatarBg, initials,
} from '../../pages/Outing/shared.jsx'

// Per-player prop tolerance: several props here (playerTeam, diffStr,
// netDiffStr) are FUNCTIONS called per-player by the multi surface, but a
// consumer passing a plain value must not crash the scorecard. Resolve
// either shape. (S4 hardening — see the 07-06 prop-contract crashes.)
function perPlayer(propValue, ...args) {
  return typeof propValue === 'function' ? propValue(...args) : propValue
}

// ─── Shared scorecard chrome (2026-07-06 unification) — the LEADERS plaque +
// Augusta footer that frame the scorecard, extracted so SOLO renders the
// exact same chrome. JSX moved verbatim from the LiveOuting return. ───
export function LeadersPlaque() {
  return (
        <div style={{
          background: `linear-gradient(180deg, ${AUGUSTA_CREAM} 0%, #DDD2A8 100%)`,
          borderBottom: '1px solid ' + AUGUSTA_GREEN,
          textAlign: 'center', padding: '10px 0 8px',
          flexShrink: 0, position: 'relative',
          boxShadow: 'inset 0 -1px 2px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',
        }}>
          {/* Top gold rule */}
          <div style={{
            position: 'absolute', top: 0, left: '12%', right: '12%',
            height: 1, background: AUGUSTA_GOLD_DIM, opacity: 0.7,
          }} />
          <div style={{
            fontSize: 36, fontWeight: 900, lineHeight: 1, color: AUGUSTA_GREEN,
            letterSpacing: '0.20em',
            fontFamily: '"Georgia", "Times New Roman", serif',
            textShadow: '0 1px 0 rgba(255,255,255,0.7), 0 -1px 0 rgba(0,0,0,0.20)',
          }}>LEADERS</div>
          {/* Bottom gold rule */}
          <div style={{
            position: 'absolute', bottom: 4, left: '20%', right: '20%',
            height: 1, background: AUGUSTA_GOLD_DIM, opacity: 0.55,
          }} />
        </div>
  )
}

export function AugustaPlaqueFooter() {
  return (
        <div style={{
          background: AUGUSTA_GREEN,
          padding: '8px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
          borderTop: '2px solid ' + AUGUSTA_WOOD,
          flexShrink: 0,
        }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#FFD700',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, color: AUGUSTA_GREEN, fontFamily: '"Georgia", serif',
          }}>M</span>
          <div style={{
            fontFamily: '"Georgia", "Times New Roman", serif',
            fontSize: 14, color: AUGUSTA_TEXT, fontStyle: 'italic', letterSpacing: '0.10em',
          }}>Augusta National Club Golf</div>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#FFD700',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, color: AUGUSTA_GREEN, fontFamily: '"Georgia", serif',
          }}>M</span>
        </div>
  )
}

// Exported 2026-05-07 PM so the solo-round score modal (ActiveRound.jsx)
// can fire the same gold "Saved" flash that multi-player matches show
// — Matt: 'why is there no saved pop up after a score is entered like
// in multiplayer matches?'. Same component, same animation, same
// position; ActiveRound just sets its own savedAt timestamp after each
// onScore call.
export function SavedChip({ savedAt }) {
  // Schedule a re-render after the animation duration so the chip
  // unmounts cleanly. Without this, the DOM node would linger
  // (transparent, opacity 0 from CSS animation forwards) until the
  // next save retriggers it.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setTick(n => n + 1), 1750)
    return () => clearTimeout(t)
  }, [savedAt])
  if (!savedAt || (Date.now() - savedAt) > 1750) return null

  // 2026-05-06 — render via createPortal to document.body so the chip's
  // `position: fixed` is viewport-relative, not relative to the
  // TabPanel's pull-to-refresh wrapper (which has transform:translateY
  // and per CSS spec creates a containing block for fixed descendants).
  // Without the portal the chip lands below the bottom nav off-screen.
  //
  // Animation: a single CSS keyframe (tm-saved-flash) drives the full
  // 0→fade-in→hold→fade-out lifecycle on the GPU compositor — no React
  // re-renders required mid-animation. Earlier JS-driven opacity math
  // depended on the component re-rendering at every animation frame,
  // which it didn't, so the chip displayed its mount-time opacity (0)
  // for the entire visible window and looked transparent. CSS-only
  // animation makes that impossible.
  //
  // Color: solid gold gradient (matches Share Code with Group + the
  // rest of the app's gold accents). Dark ink text on gold for
  // contrast on any background. key={savedAt} forces React to unmount
  // and remount on each new save, restarting the keyframe from the
  // top.
  return createPortal(
    <div
      key={savedAt}
      aria-live="polite"
      className="tm-anim-saved"
      style={{
        position: 'fixed',
        bottom: 'calc(56px + env(safe-area-inset-bottom) + 12px)',
        right: 16,
        zIndex: 50,
        background: 'linear-gradient(135deg, #F5D78A 0%, var(--tm-gold) 100%)',
        color: '#070C09',
        padding: '10px 18px',
        borderRadius: 999,
        fontSize: 14, fontWeight: 800,
        boxShadow: '0 8px 24px rgba(201,160,64,0.55), inset 0 1px 0 rgba(255,255,255,0.40)',
        border: '1.5px solid rgba(122,88,0,0.45)',
        display: 'flex', alignItems: 'center', gap: 6,
        pointerEvents: 'none',
      }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Saved
    </div>,
    document.body
  )
}

// Cell coloring per golf scorecard tradition
// Augusta-style cell: cream tile, red numerals for under-par, ink for
// over-par. Birdie = single red circle, eagle = double red circle, bogey
// = single black square, double = double black square. Subtotals (OUT/IN)
// render as deeper teal cells with white block text.
export function cellBg(score, par, isSubtotal) {
  // Body subtotal cells (LAVIN's OUT total, filler row OUT cells) now use
  // AUGUSTA_GREEN_DEEP — same color as the OUT/IN/35/36 header cells — so
  // the rightmost column reads as one continuous dark-green strip top to
  // bottom. (2026-04-30 PM round 6 — user wanted these same color as the
  // box 36 and IN are in.)
  if (isSubtotal) return AUGUSTA_GREEN_DEEP
  // Every score cell — filled or empty — uses the same solid cream so the
  // board reads as a uniform grid of score slots. The presence/absence of
  // a numeral is the only difference.
  return AUGUSTA_TILE
}
export function cellColor(score, par, isSubtotal) {
  if (isSubtotal) return '#fff'
  if (!score || !par) return AUGUSTA_INK
  return score - par < 0 ? AUGUSTA_RED : AUGUSTA_INK
}

// Border helper used by ScoreModal's quick-pick chips. The Augusta cells
// don't really need this anymore (they share borders), but ScoreModal still
// references it to color-code the picked chip. (2026-04-30 PM round 7
// regression fix — was removed in round 5 but ScoreModal still called it.)
export function cellBorder(score, par) {
  if (!score || !par) return '1px solid rgba(0,0,0,0.20)'
  const d = score - par
  if (d <= -1) return `1.5px solid ${AUGUSTA_RED}`
  if (d >= 1)  return `1.5px solid ${AUGUSTA_INK}`
  return '1px solid rgba(0,0,0,0.30)'
}

// Single scorecard cell — tappable by host for any player, or by self.
// Borders use only `borderLeft` so adjacent cells share a single 1px line
// (matches the header rows' borderLeft scheme; otherwise body cells stacked
// 2px between them and looked misaligned with headers when scrolled).
// (2026-04-30 PM border-cleanup)
export function ScorecardCell({ score, par, canEdit, onTap, isSubtotal, isHint, overrideBg, overrideBorder, overrideColor, w = 32, h = 36, skinsBadge = null }) {
  // Subtotal cells used to be `w + 4` for visual emphasis, but that made
  // the body OUT/IN column 4px wider than the header OUT/IN column —
  // so the body subtotal cells (LAVIN's 12, filler rows) stuck out past
  // the header's OUT and the BACK-9 IN/36 cells. Now unified at w so
  // the column lines up. (2026-04-30 PM round 5)
  const bg     = overrideBg     ?? cellBg(score, par, isSubtotal)
  const color  = overrideColor  ?? cellColor(score, par, isSubtotal)
  const diff   = (!isSubtotal && score && par) ? score - par : null
  // Border treatment — only the LEFT edge so adjacent cells share a divider.
  // Subtotal cells (OUT/IN) used to get a heavier 2px borderLeft, which made
  // the hole-9→OUT boundary visibly step and made the horizontal HOLE→PAR
  // divider appear to "break off" at hole 8/9. Now uses the same 1px
  // dark-alpha as other cells; visual distinction comes from bg color
  // (cream tile vs dark green strip). (2026-04-30 PM)
  const borderLeft = overrideBorder ?? '1px solid rgba(0,0,0,0.20)'
  return (
    <div
      onClick={canEdit && !isSubtotal ? onTap : undefined}
      className={isHint ? 'tm-tap-hint' : undefined}
      style={{
        minWidth: w, width: w, height: h,
        background: bg,
        borderLeft,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: isSubtotal ? 14 : 15, fontWeight: 900,
        fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
        color, cursor: canEdit && !isSubtotal ? 'pointer' : 'default',
        flexShrink: 0, userSelect: 'none',
        position: 'relative',
        // Subtle inset shadow at the TOP of each tile (so it reads as
        // slotted into the board). Removed the previous bottom highlight
        // — it created a 1px white line at the bottom of cream cells that
        // didn't exist on subtotal cells, making them appear visually
        // misaligned with the OUT/IN box next to them. (2026-04-30 PM
        // round 6 — user: "make them line up perfectly")
        // When isHint is active, skip inline shadow so the tm-tap-hint
        // keyframe (which animates box-shadow) takes over without being
        // overridden by an inline style.
        boxShadow: isHint
          ? undefined
          : isSubtotal
            ? 'inset 0 1px 2px rgba(0,0,0,0.50)'
            : 'inset 0 1px 2px rgba(0,0,0,0.18)',
      }}
    >
      {/* Birdie / Eagle: red circle (or two for eagle) */}
      {diff === -1 && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />}
      {diff != null && diff <= -2 && <>
        <div style={{ position: 'absolute', inset: 2, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />
      </>}
      {/* Bogey / Double: black square (or two for double) */}
      {diff === 1 && <div style={{ position: 'absolute', inset: 3, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />}
      {diff != null && diff >= 2 && <>
        <div style={{ position: 'absolute', inset: 2, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 6, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />
      </>}
      {/* Score numeral — keyed by score so React remounts it when the
          score changes, which retriggers the tm-score-reveal animation
          (a small scale-up flip mimicking the Masters card-flip). */}
      {(score || isSubtotal) ? (
        <span
          key={`s${score ?? ''}-p${par ?? ''}`}
          className="tm-score-reveal"
          style={{ display: 'inline-block', position: 'relative' }}
        >
          {score || ''}
        </span>
      ) : null}
      {/* Skins badge — overlaid in top-right when the player won this
          hole's skin (W) or the hole rolled forward (↻). 'W' is gold;
          carry mark uses cream + a small stack indicator showing how
          many skins are riding. (B4c polish — final pass.) */}
      {skinsBadge && skinsBadge.kind === 'win' && (
        <div title={`Won this skin${skinsBadge.value > 1 ? ` (${skinsBadge.value} skins)` : ''}`} style={{
          position: 'absolute', top: 1, right: 1,
          background: 'var(--tm-gold)', color: '#070C09',
          fontSize: 7, fontWeight: 900, lineHeight: 1, letterSpacing: 0,
          padding: '1px 3px', borderRadius: 2,
          pointerEvents: 'none',
        }}>{skinsBadge.value > 1 ? `W${skinsBadge.value}` : 'W'}</div>
      )}
      {skinsBadge && skinsBadge.kind === 'carry' && (
        <div title={`Carrying ${skinsBadge.value} skin${skinsBadge.value !== 1 ? 's' : ''} forward`} style={{
          position: 'absolute', top: 1, right: 1,
          background: 'rgba(0,0,0,0.55)', color: AUGUSTA_CREAM,
          fontSize: 8, fontWeight: 800, lineHeight: 1,
          padding: '1px 3px', borderRadius: 2,
          pointerEvents: 'none',
        }}>↻{skinsBadge.value}</div>
      )}
    </div>
  )
}

// Find the first cell the current user can tap to enter a score — used
// to render a pulsing gold tap-hint on it. Walks sorted players in order;
// for each player the user can edit, picks the first unscored hole.
// Returns { userId, hole } or null when nothing's tappable. Skips the hint
// once any score has been entered (the empty-board prompt only). (2026-04-30 PM round 11)
export function findTapHint({ sorted, getScores, isHost, isMarkerFor, userId }) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null
  // If any score exists anywhere, no hint — the user already knows.
  const anyScored = sorted.some(p => (getScores(p) || []).some(s => s > 0))
  if (anyScored) return null
  for (const p of sorted) {
    const isMe   = String(p.user_id) === String(userId)
    const canEdit = isHost
      || (isMarkerFor ? isMarkerFor(String(userId), String(p.user_id)) : false)
      || isMe
    if (!canEdit) continue
    const sc = getScores(p) || []
    for (let h = 0; h < Math.max(18, sc.length); h++) {
      if (!sc[h]) return { userId: p.user_id, hole: h }
    }
  }
  return null
}

// Compute leaderboard positions for an already-sorted player array.
// Returns an array of strings parallel to `sorted`: "1", "T2", "3", or "—"
// for players with no scores yet. (2026-04-30 PM round 8 — rank badges)
// Tiebreak label for a player who beat the next-tied player on
// card-back. Returns 'b9' / 'l6' / 'l3' / 'lh' or null. Used by
// the scoreboard to annotate "won on back-9" so users understand
// why two equal totals got different ranks. (Iteration 3 polish for B1.)
function tiebreakReason(a, b, holePars) {
  if (!a || !b) return null
  const holeCount = holePars.length
  const lastIdx   = holeCount - 1
  function strokesToParRange(p, getScores, startIdx, endIdx) {
    const sc = (getScores ? getScores(p) : p.scores) || []
    let total = 0
    for (let i = startIdx; i <= endIdx; i++) {
      const s = sc[i] || 0
      if (s > 0) total += s - (holePars[i] || 4)
    }
    return total
  }
  const ranges = [
    ...(holeCount >= 18 ? [{ key: 'b9', s: 9, e: 17 }] : []),
    { key: 'l6', s: Math.max(0, lastIdx - 5), e: lastIdx },
    { key: 'l3', s: Math.max(0, lastIdx - 2), e: lastIdx },
    { key: 'lh', s: lastIdx, e: lastIdx },
  ]
  // Use whatever's on each participant directly; the function may be
  // called from anywhere with .scores already set on the player obj.
  const get = p => p.scores
  for (const r of ranges) {
    const ra = strokesToParRange(a, get, r.s, r.e)
    const rb = strokesToParRange(b, get, r.s, r.e)
    if (ra !== rb) return ra < rb ? r.key : null
  }
  return null
}

// Compute display rank labels (1, T2, T2, 4, ...) for a sorted-by-
// leaderboardSort participants array. Two adjacent entries are
// considered tied (sharing position) ONLY when their full multi-key
// comparison comes out equal — i.e. same total AND same card-back
// AND same last-6/3/last-hole. If any tiebreaker separated them, the
// earlier one gets the cleaner rank. (2026-05-01 — league must-have B1.)
export function computePositions(sorted, getScores, holePars) {
  const holeCount = holePars.length
  const lastIdx   = holeCount - 1
  // All four tiebreaker key ranges, computed once per call.
  const tieRanges = []
  if (holeCount >= 18) tieRanges.push([9, 17])
  tieRanges.push([Math.max(0, lastIdx - 5), lastIdx])
  tieRanges.push([Math.max(0, lastIdx - 2), lastIdx])
  tieRanges.push([lastIdx, lastIdx])

  function strokesToParRange(p, startIdx, endIdx) {
    const sc = getScores(p)
    let total = 0
    for (let i = startIdx; i <= endIdx; i++) {
      const s = sc[i] || 0
      if (s > 0) total += s - (holePars[i] || 4)
    }
    return total
  }
  function totalStp(p) {
    const sc = getScores(p)
    const played = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!played.length) return null
    return played.reduce((sum, x) => sum + (x.s - (holePars[x.i] || 4)), 0)
  }

  // Returns true if two players are tied through ALL tiebreaker keys.
  function fullyTied(a, b) {
    const da = totalStp(a), db = totalStp(b)
    if (da == null || db == null) return da === db
    if (da !== db) return false
    for (const [s, e] of tieRanges) {
      if (strokesToParRange(a, s, e) !== strokesToParRange(b, s, e)) return false
    }
    return true
  }

  // First pass: assign raw rank. New rank only when not tied with the
  // immediately preceding entry. Players with no scores get '—'.
  const rawRanks = []
  for (let i = 0; i < sorted.length; i++) {
    if (totalStp(sorted[i]) == null) { rawRanks.push('—'); continue }
    if (i === 0) { rawRanks.push(1); continue }
    const prevRank = rawRanks[i - 1]
    if (prevRank === '—') { rawRanks.push(i + 1); continue }
    rawRanks.push(fullyTied(sorted[i - 1], sorted[i]) ? prevRank : i + 1)
  }
  // Second pass: T-prefix any rank that appears more than once.
  const counts = {}
  rawRanks.forEach(r => { if (r !== '—') counts[r] = (counts[r] || 0) + 1 })
  return rawRanks.map(r => r === '—' ? r : counts[r] > 1 ? `T${r}` : `${r}`)
}

// ─── Match Scoreboard (Tour-page-style leaderboard view) ─────────────────────
//
// The "BOARD" alternative to the Augusta scorecard. Mirrors PGAScores.jsx
// visually so the user's match scoreboard reads like the live PGA Tour
// leaderboard — same translucent glass card, same column grid (POS, photo,
// name, TOT, [TODAY for match-play], THRU), same score colors via the
// shared scoreColors lib. (2026-05-01 — match-page completion plan, Thread 1)
//
// Read-only. Tapping a row asks the parent to switch back to the SCORECARD
// view focused on that player (handled by the parent via onPlayerTap).
export function MatchScoreboard({
  participants,            // already-sorted by leaderboardSort
  positions,               // computed by computePositions()
  getScores,
  holePars,
  holeCount,
  netMode,
  hcpAllowance = 100,      // % of raw handicap to apply (B4a)
  outingMeta = {},         // { teeRatings, courseRating, slopeRating, coursePar } for per-player Course Handicap (2026-06-25)
  isMatchPlay,
  matchPlayData,
  diffStr,                 // gross score-to-par for holes played
  netDiffStr,              // net score-to-par for holes played
  user,
  onPlayerTap,             // (userId) => void — jump to scorecard focused on player
  isSkinsFormat = false,   // when true, render per-row 'N SK' badge (B4c polish)
  skinsByPlayer = {},      // { user_id: skinsWonCount }
}) {
  // Tapped player's Course Handicap breakdown (mobile bottom sheet). null = closed.
  const [chInfo, setChInfo] = useState(null)
  // Tiebreak hints — for each row that's tied on total with the row
  // below it, surface a tiny pill ('B9' / 'L6' / 'L3' / 'LH') so
  // players understand why the cleaner rank went to one over the
  // other. (Iteration 3 polish for B1.)
  function tiebreakHint(i) {
    if (isMatchPlay || isSkinsFormat) return null  // those use different sort keys
    const a = participants[i]
    const b = participants[i + 1]
    if (!a || !b) return null
    // Only hint when the two are tied on TOTAL strokes-to-par.
    const totalSTP = (p) => {
      const sc = getScores(p) || []
      let stp = 0
      for (let h = 0; h < holePars.length; h++) {
        const s = sc[h] || 0
        if (s > 0) stp += s - (holePars[h] || 4)
      }
      return sc.some(x => x > 0) ? stp : null
    }
    const ta = totalSTP(a), tb = totalSTP(b)
    if (ta == null || tb == null || ta !== tb) return null
    const aWithScores = { ...a, scores: getScores(a) }
    const bWithScores = { ...b, scores: getScores(b) }
    return tiebreakReason(aWithScores, bWithScores, holePars)
  }
  const TIEBREAK_LABELS = { b9: 'B9', l6: 'L6', l3: 'L3', lh: 'LH' }
  // Match-play TOT for the current row. Only meaningful when isMatchPlay
  // (2 players + 'match' format). Returns "3UP" / "AS" / "3DN" or null.
  function matchPlayLabel(p, idx) {
    if (!isMatchPlay || !matchPlayData) return null
    const { p1HolesUp, played, remaining } = matchPlayData
    if (played === 0) return 'AS'
    // matchPlayData computed against participants[0] vs [1] in original
    // sort order; positions[idx] is the leaderboard rank from sorted[]
    // which is the same order used by computeMatchPlay's caller. So
    // p1HolesUp > 0 means participants[0] is up. We need to know if THIS
    // row is participant 0 or 1 in that match.
    const isFirst = String(p.user_id) === String(participants[0].user_id)
    const myUp = isFirst ? p1HolesUp : -p1HolesUp
    if (myUp === 0) return 'AS'
    if (Math.abs(myUp) > remaining && remaining >= 0) {
      // Match is decided
      return myUp > 0 ? `${myUp}&${remaining}` : `${-myUp}DN`
    }
    return myUp > 0 ? `${myUp}UP` : `${-myUp}DN`
  }

  // THRU label — number of holes scored, "F" when complete
  function thruLabel(p) {
    const played = getScores(p).filter(s => s > 0).length
    if (played === 0) return '—'
    if (played >= holeCount) return 'F'
    return String(played)
  }

  // Score-to-par numeric (for color lookup) — null when no holes played yet
  function diffNumeric(p) {
    const sc = getScores(p)
    const holesPlayed = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!holesPlayed.length) return null
    const parSoFar   = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    // Handicap (sign-preserving for plus-handicap players). Mirror of
    // netStrokes() in LiveOuting — kept inline here so the scoreboard
    // doesn't have to import. Round 1 fix.
    // Course Handicap (slope-based) — same conversion as netStrokes() so this
    // scoreboard mirror stays in lockstep. (2026-06-25)
    const rawH = netMode ? courseHandicap(parseFloat(p.handicap) || 0, playerTeeRatings(p?.gender, outingMeta)) : 0
    // WHS Playing Handicap = round(CH × allowance) — round, not floor. Mirror of
    // netStrokes(); kept in lockstep. (handicap audit 2026-06-25)
    const hcp  = rawH === 0 ? 0 : (rawH > 0 ? 1 : -1) * Math.round(Math.abs(rawH) * hcpAllowance / 100)
    return totalSoFar - hcp - parSoFar
  }

  // For match-play matches, TOT shows match-play state and TODAY shows
  // score-to-par. For everything else, drop the TODAY column entirely so
  // the player name has more room.
  const gridTemplate = isMatchPlay
    ? '28px 44px 1fr 50px 50px 36px'
    : '28px 44px 1fr 50px 36px'

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '12px 16px 24px',
    }}>
      {/* Translucent glass card wrapping the whole leaderboard. Same
          treatment as the Tour page's leaderboard so the visual
          language stays identical between watching the pros and
          watching your own match. */}
      <div style={{
        background: 'rgba(255,255,255,0.22)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.45)',
        borderRadius: 16,
        padding: '12px 12px 4px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          gap: 4, padding: '0 4px 6px',
          borderBottom: '1px solid rgba(27,94,59,0.18)',
          marginBottom: 6,
        }}>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>POS</div>
          <div />
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em' }}>PLAYER</div>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>{isMatchPlay ? 'MATCH' : 'TOT'}</div>
          {isMatchPlay && (
            <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>TODAY</div>
          )}
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>THRU</div>
        </div>

        {/* Player rows */}
        {participants.map((p, idx) => {
          const pos     = positions[idx] || '—'
          const isMe    = String(p.user_id) === String(user?.id)
          const numeric = diffNumeric(p)
          // Course Handicap chip (NET mode, rated outings) — transparency for
          // the strokes a player gets. Same basis as diffNumeric (raw index),
          // and only shown when the outing actually has ratings so it's never a
          // redundant "CH == index". Gender-correct via playerTeeRatings. (2026-06-25)
          const idxVal   = !p.is_guest ? parseFloat(p.handicap) : NaN
          const pr       = (netMode && Number.isFinite(idxVal)) ? playerTeeRatings(p?.gender, outingMeta) : null
          const hasRtg   = pr && Number.isFinite(Number(pr.slope)) && Number.isFinite(Number(pr.rating))
          const chVal    = hasRtg ? Math.round(courseHandicap(idxVal, pr)) : null
          const skinsCount = isSkinsFormat ? (skinsByPlayer[p.user_id] || 0) : 0
          // For skins format, the headline TOT becomes 'N SK' so the
          // leaderboard reads at a glance — STP becomes the secondary
          // signal. (Iteration 2 polish for B4c.)
          const totDisplay = isMatchPlay
            ? (matchPlayLabel(p, idx) || '—')
            : isSkinsFormat
              ? `${skinsCount} SK`
              : (netMode ? perPlayer(netDiffStr, p) : perPlayer(diffStr, p))
          const todayDisplay = isMatchPlay
            ? (netMode ? perPlayer(netDiffStr, p) : perPlayer(diffStr, p))
            : isSkinsFormat
              ? (netMode ? perPlayer(netDiffStr, p) : perPlayer(diffStr, p))  // show STP under skins as secondary
              : null

          return (
            <button
              key={p.user_id}
              onClick={() => onPlayerTap?.(p.user_id)}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: gridTemplate,
                gap: 4, alignItems: 'center',
                padding: '7px 4px',
                borderBottom: '1px solid rgba(27,94,59,0.10)',
                // Leader gold-tint matches Tour page; current user gets
                // a subtle additional accent (gold-tinted left border).
                background: idx === 0
                  ? 'rgba(201,160,64,0.20)'
                  : 'transparent',
                borderRadius: idx === 0 ? 8 : 0,
                borderLeft: isMe ? '3px solid var(--tm-gold)' : '3px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
              }}
            >
              {/* Position */}
              <div style={{
                textAlign: 'center',
                fontSize: pos.length > 3 ? 9 : 11,
                fontWeight: 700,
                color: idx < 3 ? 'var(--tm-gold)' : 'rgba(27,94,59,0.50)',
              }}>
                {pos}
              </div>

              {/* Avatar — 38px square, mirrors PGAScores.jsx PlayerPhoto.
                  We reuse PlayerAvatar (which already handles avatar URL +
                  initials fallback) but force a square box via a wrapping div
                  so the look matches the Tour page. */}
              <div style={{
                width: 38, height: 38, borderRadius: 10, overflow: 'hidden',
                background: 'rgba(27,94,59,0.08)',
                border: '1px solid rgba(27,94,59,0.12)',
                position: 'relative',
              }}>
                {p.avatar ? (
                  <img
                    src={p.avatar}
                    alt={p.name || ''}
                    style={{
                      width: '100%', height: '100%',
                      objectFit: 'cover', objectPosition: 'top center',
                    }}
                  />
                ) : (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800, color: '#fff',
                    background: avatarBg(p.name || ''),
                  }}>{initials(p.name || '') || '·'}</div>
                )}
              </div>

              {/* Name + subline (guest tag / handicap) */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: idx < 5 ? 700 : 500,
                  color: 'var(--tm-text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.name}</div>
                {chVal != null ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, whiteSpace: 'nowrap' }}>
                    {/* Tappable CH pill → bottom-sheet breakdown (mobile-native;
                        stops the row's tap so it doesn't jump to the scorecard). */}
                    <span
                      role="button"
                      aria-label={`Course Handicap ${chVal}, tap for details`}
                      onClick={(e) => { e.stopPropagation(); setChInfo({ name: p.name, ch: chVal, idx: idxVal, slope: pr.slope, rating: pr.rating, par: outingMeta.coursePar, gender: p.gender }) }}
                      style={{
                        padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 800, letterSpacing: '0.03em',
                        background: 'rgba(201,160,64,0.18)', color: 'var(--tm-gold-text)', cursor: 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                      }}>CH {chVal} <span style={{ opacity: 0.6, fontWeight: 700 }}>ⓘ</span></span>
                    <span style={{ fontSize: 9, color: 'rgba(27,94,59,0.45)', fontWeight: 500 }}>{idxVal.toFixed(1)} idx</span>
                  </div>
                ) : (p.is_guest || (p.handicap != null && !p.is_guest)) ? (
                  <div style={{
                    fontSize: 9, color: 'rgba(27,94,59,0.45)', fontWeight: 500,
                    letterSpacing: '0.02em', marginTop: 1,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {p.is_guest ? 'Guest' : `${parseFloat(p.handicap).toFixed(1)} hcp`}
                  </div>
                ) : null}
              </div>

              {/* TOT (or MATCH label for match-play) */}
              <div style={{ textAlign: 'center' }}>
                <span style={{
                  fontSize: 13, fontWeight: 800,
                  color: isMatchPlay
                    ? (totDisplay === 'AS' ? 'var(--tm-green)' : totDisplay.endsWith('DN') ? '#DC2626' : 'var(--tm-gold)')
                    : scoreToParColor(numeric),
                }}>
                  {totDisplay}
                </span>
                {/* Card-back tiebreak hint — small pill when this player
                    beat the next-tied player on a back-9 / last-N
                    tiebreak. Helps explain "we tied at 78 — why am I
                    2nd?" without forcing the host to. (B1 polish.) */}
                {(() => {
                  const hint = tiebreakHint(idx)
                  if (!hint) return null
                  return (
                    <div title={`Won on ${hint === 'b9' ? 'back 9' : hint === 'l6' ? 'last 6 holes' : hint === 'l3' ? 'last 3 holes' : 'last hole'}`} style={{
                      display: 'inline-block', marginTop: 2, padding: '0 5px',
                      borderRadius: 4, fontSize: 8, fontWeight: 800, letterSpacing: '0.08em',
                      background: 'rgba(201,160,64,0.18)', color: 'var(--tm-gold-text)',
                      border: '1px solid rgba(201,160,64,0.35)',
                    }}>{TIEBREAK_LABELS[hint]}</div>
                  )
                })()}
              </div>

              {/* TODAY (only for match-play matches) */}
              {isMatchPlay && (
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: scoreToParColor(numeric),
                  }}>
                    {todayDisplay}
                  </span>
                </div>
              )}

              {/* THRU */}
              <div style={{
                textAlign: 'center', fontSize: 11,
                color: thruLabel(p) === 'F' ? 'rgba(27,94,59,0.55)' : 'rgba(27,94,59,0.45)',
                fontWeight: thruLabel(p) === 'F' ? 700 : 400,
              }}>
                {thruLabel(p)}
              </div>
            </button>
          )
        })}

        {/* Footer */}
        <div style={{ padding: '12px 4px 4px', color: 'rgba(27,94,59,0.50)', fontSize: 10, textAlign: 'center' }}>
          Tap a row to score{netMode ? ' · NET' : ''}
        </div>
      </div>

      {/* Course Handicap breakdown — mobile bottom sheet (tap a CH chip). */}
      {chInfo && createPortal(
        <div onClick={() => setChInfo(null)} style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(13,31,18,0.45)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 480, background: 'linear-gradient(180deg, #FFFFFF, var(--tm-surface-2))',
            borderTopLeftRadius: 22, borderTopRightRadius: 22, border: '1px solid rgba(27,94,59,0.12)',
            padding: '10px 22px max(24px, env(safe-area-inset-bottom))', boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 14px' }}>
              <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(27,94,59,0.18)' }} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(27,94,59,0.55)' }}>COURSE HANDICAP</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
              <span style={{ fontSize: 46, fontWeight: 900, color: 'var(--tm-green)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{chInfo.ch}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--tm-text)' }}>{chInfo.name}</span>
            </div>
            <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(27,94,59,0.05)', border: '1px solid rgba(27,94,59,0.10)', borderRadius: 14 }}>
              {[
                ['Handicap index', chInfo.idx.toFixed(1)],
                ['Slope rating', `${chInfo.slope} ÷ 113`],
                ['Course rating − par', `${chInfo.rating} − ${chInfo.par}`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 14 }}>
                  <span style={{ color: 'var(--tm-text-2, var(--tm-text-2))' }}>{k}</span>
                  <span style={{ fontWeight: 800, color: 'var(--tm-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid rgba(27,94,59,0.15)', marginTop: 6, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-green)' }}>= Course Handicap</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--tm-green)', fontVariantNumeric: 'tabular-nums' }}>{chInfo.ch}</span>
              </div>
            </div>
            {(chInfo.gender === 'male' || chInfo.gender === 'female') && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--tm-text-2, var(--tm-text-2))', textAlign: 'center' }}>
                Uses the {chInfo.gender === 'female' ? "women's" : "men's"} rating for these tees.
              </div>
            )}
            <button onClick={() => setChInfo(null)} style={{
              width: '100%', marginTop: 18, height: 48, borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))', color: '#070C09',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
            }}>Done</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Scorecard table (front or back 9) ───────────────────────────────────────
// 2026-07-17 (Matt) — shared responsive column math so BOTH scorecard owners
// (solo ActiveRound + match LiveOuting) fit all 9 holes + OUT on screen with
// ZERO horizontal scrolling. The rank column is gone from the scorecard (the
// BOARD view owns standings); identity = avatar + name only. HOLE_COL divides
// the remaining width; floor 24pt keeps tiles tappable-ish on the narrowest
// phones (row height 56–80 carries the touch target).
export function scorecardCols() {
  // Frame width must match App.jsx's phone-frame rule: full viewport on
  // phones (≤520pt), 430pt centered frame on desktop-class widths.
  const vw = typeof window !== 'undefined'
    ? (window.innerWidth <= 520 ? window.innerWidth : 430)
    : 390
  const AVATAR_COL = 48
  const NAME_COL   = 84
  const SUB_COL    = 36
  const PLAYER_COL = AVATAR_COL + NAME_COL
  const HOLE_COL   = Math.max(24, Math.floor((vw - PLAYER_COL - SUB_COL) / 9))
  return { PLAYER_COL, AVATAR_COL, NAME_COL, HOLE_COL, SUB_COL }
}

export function ScorecardTable({ label, holes, holePars, subtotalPar, participants, getScores, isHost, userId, isMarkerFor, playerTeam = () => null, onCellTap, onHoleHeaderTap, matchPlayData, isP1, PLAYER_COL, AVATAR_COL = 48, NAME_COL = 84, HOLE_COL, SUB_COL, rowH = 56, fillerRows = 0, positions = [], activeHole = null, tapHint = null, skinsOutcomes = null }) {
  // Tournament-board look: deep forest green panels with white block letters,
  // gold PAR numerals, dark green OUT/IN strip with white. Subtle gradient
  // gives the panels light-from-above weight. (2026-04-30 PM revision)
  const panelGradient = `linear-gradient(180deg, ${AUGUSTA_PANEL_HI} 0%, ${AUGUSTA_PANEL} 100%)`
  // Divider color uses neutral black-alpha (not AUGUSTA_GREEN_DEEP) so the
  // horizontal line is visible across BOTH the gradient panel AND the dark
  // green OUT/IN strip — fixes the "line breaks off at hole 8/9" bug
  // where the divider visually disappeared at the OUT cell because its bg
  // was the same color as the divider. (2026-04-30 PM)
  const dividerColor = 'rgba(0,0,0,0.50)'
  const headerRow = {
    display: 'flex', alignItems: 'center',
    borderBottom: '1px solid ' + dividerColor,
    background: panelGradient,
    // Row sizes to its content so the borderBottom spans the full width of
    // all cells (avatar + name + 9 hole cells + OUT subtotal). Without this
    // the row only expands to the scroll container's width and the
    // borderBottom cuts off mid-row when scrolled. (2026-04-30 PM round 4 —
    // user noticed the cut-off after the AVATAR_COL split widened rows
    // beyond the viewport.)
    width: 'max-content',
    minWidth: '100%',
  }
  const headerNameCol = {
    minWidth: PLAYER_COL, width: PLAYER_COL, padding: '8px 10px',
    fontSize: 12, fontWeight: 900, color: AUGUSTA_TEXT,
    fontFamily: '"Arial Black", Arial, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0,
    // 2026-07-17 (design audit, Matt) — the identity columns freeze while
    // the hole grid scrolls. Without sticky, any horizontal scroll pushed
    // rank/avatar/name off-screen ("ANIEL / ATT / AMES"). Header label
    // cells pin with the same offset so rows stay aligned.
    position: 'sticky', left: 0, zIndex: 2, background: panelGradient,
    display: 'flex', alignItems: 'center', height: 34, boxSizing: 'border-box',
  }
  const headerHoleCell = {
    minWidth: HOLE_COL, width: HOLE_COL, height: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 900, color: AUGUSTA_TEXT,
    fontFamily: '"Arial Black", Arial, sans-serif',
    flexShrink: 0,
    // Match body cells' borderLeft color so vertical dividers run continuously
    // from header through every body row when scrolled (2026-04-30 PM fix).
    borderLeft: '1px solid rgba(0,0,0,0.20)',
  }
  // Subtotal header cell (OUT / IN): same 1px borderLeft as hole cells so the
  // hole-9 → OUT boundary doesn't have a visible "step" that makes the
  // horizontal HOLE→PAR divider look like it breaks off. (2026-04-30 PM)
  const subtotalHeaderCell = {
    minWidth: SUB_COL, width: SUB_COL, height: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 900, color: AUGUSTA_GOLD,
    fontFamily: '"Arial Black", Arial, sans-serif',
    background: AUGUSTA_GREEN_DEEP, letterSpacing: '0.06em', flexShrink: 0,
    textShadow: '0 1px 1px rgba(0,0,0,0.50)',
    borderLeft: '1px solid rgba(0,0,0,0.50)',
  }

  return (
    <div style={{ marginBottom: 0 }}>
      {/* HOLE row — green panel with white numerals + gold OUT/IN.
          Active hole gets a small green flag pin on top of the numeral.
          When onHoleHeaderTap is provided (host on a multi-player group),
          each hole numeral becomes a tappable button that opens the bulk
          entry modal — see "BulkScoreModal" / setBulkEntryHole. (6.2) */}
      <div style={headerRow}>
        <div style={headerNameCol}>{label}</div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          {holes.map(h => {
            const tappable = !!onHoleHeaderTap
            const cellInner = (
              <>
                {h + 1}
                {activeHole === h && (
                  <span style={{
                    position: 'absolute', top: -6, right: 2,
                    width: 9, height: 12,
                    pointerEvents: 'none',
                  }} aria-label="Active hole">
                    <svg width="9" height="12" viewBox="0 0 9 12" fill="none">
                      <line x1="1" y1="0" x2="1" y2="12" stroke="#fff" strokeWidth="1" />
                      <path d="M1 1 L8 3 L1 5 Z" fill={AUGUSTA_GOLD} stroke="#000" strokeWidth="0.5" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
                {tappable && (
                  <span style={{
                    position: 'absolute', bottom: -1, left: '50%',
                    transform: 'translateX(-50%)',
                    width: 14, height: 2, borderRadius: 1,
                    background: 'rgba(232,192,90,0.55)',
                    pointerEvents: 'none',
                  }} aria-hidden />
                )}
              </>
            )
            const baseStyle = { ...headerHoleCell, position: 'relative' }
            return tappable ? (
              <button
                key={h}
                type="button"
                onClick={() => onHoleHeaderTap(h)}
                aria-label={`Bulk enter scores for hole ${h + 1}`}
                style={{
                  ...baseStyle,
                  appearance: 'none',
                  border: 0,
                  borderLeft: headerHoleCell.borderLeft,
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {cellInner}
              </button>
            ) : (
              <div key={h} style={baseStyle}>
                {cellInner}
              </div>
            )
          })}
          <div style={subtotalHeaderCell}>{label === 'BACK 9' ? 'IN' : 'OUT'}</div>
        </div>
      </div>

      {/* PAR row — gold numerals on green (the iconic Augusta detail) */}
      <div style={{ ...headerRow, borderBottom: '2px solid ' + dividerColor }}>
        <div style={{ ...headerNameCol, color: AUGUSTA_GOLD }}>PAR</div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          {holes.map(h => (
            <div key={h} style={{ ...headerHoleCell, color: AUGUSTA_GOLD }}>{holePars[h]}</div>
          ))}
          <div style={{ ...subtotalHeaderCell, color: AUGUSTA_GOLD }}>{subtotalPar}</div>
        </div>
      </div>

      {/* Player rows — teal panel for name, cream tiles for scores */}
      {participants.map((p, idx) => {
        const sc       = getScores(p)
        const isMe     = String(p.user_id) === String(userId)
        const team     = perPlayer(playerTeam, p.user_id)
        const canEdit  = isHost || (isMarkerFor ? isMarkerFor(String(userId), String(p.user_id)) : false)
        const subtotal = holes.reduce((sum, h) => sum + (sc[h] || 0), 0)
        const p1       = matchPlayData ? isP1?.(p) : false
        // Surname in caps, fallback to first if single-word
        const parts    = (p.name || '').trim().split(/\s+/)
        const display  = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').toUpperCase().slice(0, 12)
        // Position + leader detection
        const position = positions[idx] || '—'
        const holesPlayed = sc.filter(s => s > 0).length
        const isLeader    = holesPlayed > 0 && (position === '1' || position === 'T1')
        // THRU indicator: hole count played, or "F" if all holes done
        const thruText    = holesPlayed === 0 ? null
                          : holesPlayed >= 18 ? 'F'
                          : `THRU ${holesPlayed}`

        return (
          <div key={p.user_id} style={{
            display: 'flex', alignItems: 'center',
            borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
            background: isMe ? AUGUSTA_PANEL_HOVER : panelGradient,
            minHeight: rowH,
            width: 'max-content', minWidth: '100%',
          }}>
            {/* 2026-07-17 (Matt) — rank column REMOVED from the scorecard:
                rows hold a FIXED order for score entry; the BOARD view owns
                live standings. isMe gold bar rides the avatar cell now.
                Avatar + name stay sticky for the narrow-phone case where a
                sliver of scroll still exists. */}
            {/* Avatar cell — photo fills edge-to-edge, square box (sticky) */}
            <div style={{
              minWidth: AVATAR_COL, width: AVATAR_COL,
              height: rowH, flexShrink: 0,
              position: 'sticky', left: 0, zIndex: 2,
              borderLeft: isMe ? `4px solid ${AUGUSTA_GOLD}` : 'none',
              boxSizing: 'border-box',
              borderRight: '1px solid rgba(0,0,0,0.30)',
              background: AUGUSTA_GREEN_DEEP,
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
            }}>
              {p.avatar ? (
                <img
                  src={p.avatar}
                  alt={p.name}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'top center',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: avatarBg(p.name),
                  color: '#fff',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  fontSize: Math.round(rowH * 0.36), fontWeight: 900,
                  letterSpacing: '0.02em',
                }}>{initials(p.name)}</div>
              )}
            </div>
            {/* Name cell — surname caps on green panel; leader gets gold.
                Sticky needs its own opaque bg or scores slide through it. */}
            <div style={{
              minWidth: NAME_COL, width: NAME_COL, height: rowH,
              padding: '0 10px', flexShrink: 0, overflow: 'hidden',
              display: 'flex', alignItems: 'center',
              position: 'sticky', left: AVATAR_COL, zIndex: 2,
              background: isMe ? AUGUSTA_PANEL_HOVER : panelGradient,
              borderRight: '1px solid rgba(0,0,0,0.18)',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 900,
                  color: isLeader ? AUGUSTA_GOLD : AUGUSTA_TEXT,
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '0.05em',
                  textShadow: isLeader
                    ? '0 1px 0 rgba(0,0,0,0.20), 0 0 6px rgba(232,192,90,0.45)'
                    : 'none',
                }}>
                  {display}
                </div>
                {/* THRU indicator if scores exist; team name otherwise */}
                {thruText && (
                  <div style={{
                    fontSize: 10, color: 'rgba(26,107,40,0.65)', fontWeight: 700,
                    letterSpacing: '0.08em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}>
                    {thruText}
                  </div>
                )}
                {!thruText && team && (
                  <div style={{
                    fontSize: 10, color: 'rgba(26,107,40,0.70)', fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}>
                    {team.name}
                  </div>
                )}
              </div>
            </div>
            {/* Score cells */}
            <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
              {holes.map(h => {
                // Match play cell override — gold if won, red if lost, neutral if halved
                let mpBg, mpBorder, mpColor
                if (matchPlayData) {
                  const res = matchPlayData.holeResults[h]
                  if (res !== null && res !== undefined) {
                    const won = p1 ? res === 'p1' : res === 'p2'
                    const halved = res === 'half'
                    if (won) { mpBg = '#FFE39A'; mpBorder = '1.5px solid ' + AUGUSTA_GREEN; mpColor = AUGUSTA_GREEN }
                    else if (!halved) { mpBg = '#FFD3D3'; mpBorder = '1.5px solid ' + AUGUSTA_RED; mpColor = AUGUSTA_RED }
                    else { mpBg = AUGUSTA_TILE; mpBorder = '1px dashed rgba(0,0,0,0.45)'; mpColor = 'rgba(0,0,0,0.55)' }
                  }
                }
                const isHint = tapHint
                  && String(tapHint.userId) === String(p.user_id)
                  && tapHint.hole === h
                // Skins decoration — only attached when this row's
                // player won the hole's skin (gold W badge), or when
                // the hole carried forward (cream ↻ badge). Other
                // players' rows on the same hole get nothing.
                let skinsBadge = null
                if (skinsOutcomes && skinsOutcomes[h]) {
                  const o = skinsOutcomes[h]
                  if (o.winner && String(o.winner) === String(p.user_id)) {
                    skinsBadge = { kind: 'win', value: o.value || 1 }
                  } else if (o.tied && o.value > 1) {
                    // Carry indicator only on the FIRST player's row
                    // for the hole — avoids stacking the same badge on
                    // every row of every losing player.
                    if (String(p.user_id) === String(participants[0]?.user_id)) {
                      skinsBadge = { kind: 'carry', value: o.value }
                    }
                  }
                }
                return (
                  <ScorecardCell
                    key={h}
                    score={sc[h] || 0}
                    par={holePars[h]}
                    canEdit={canEdit}
                    onTap={() => onCellTap(p, h)}
                    isSubtotal={false}
                    isHint={isHint}
                    w={HOLE_COL}
                    h={rowH}
                    overrideBg={mpBg}
                    overrideBorder={mpBorder}
                    overrideColor={mpColor}
                    skinsBadge={skinsBadge}
                  />
                )
              })}
              {/* Subtotal — dark green strip */}
              <ScorecardCell
                score={subtotal || null} par={null} canEdit={false} isSubtotal={true}
                w={SUB_COL} h={rowH}
              />
            </div>
          </div>
        )
      })}

      {/* Filler placeholder rows so the board always shows ≥4 rows
          when the match has fewer players. (2026-04-30 Path A) */}
      {Array(fillerRows).fill(0).map((_, i) => (
        <div key={`filler-${i}`} style={{
          display: 'flex', alignItems: 'center',
          borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
          background: panelGradient,
          minHeight: rowH,
          width: 'max-content', minWidth: '100%',
        }}>
          {/* Empty avatar cell — deep green, hint of an empty slot
              (rank column removed 2026-07-17 — geometry matches live rows) */}
          <div style={{
            minWidth: AVATAR_COL, width: AVATAR_COL, height: rowH,
            background: AUGUSTA_GREEN_DEEP,
            borderRight: '1px solid rgba(0,0,0,0.30)',
            flexShrink: 0,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
          }} />
          {/* Empty name cell */}
          <div style={{
            minWidth: NAME_COL, width: NAME_COL, height: rowH,
            padding: '0 10px', flexShrink: 0,
          }} />
          <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
            {holes.map(h => (
              <div key={h} style={{
                minWidth: HOLE_COL, width: HOLE_COL, height: rowH,
                background: AUGUSTA_TILE,
                borderLeft: '1px solid rgba(0,0,0,0.20)',
                flexShrink: 0,
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.18)',
              }} />
            ))}
            <div style={{
              minWidth: SUB_COL, width: SUB_COL, height: rowH,
              background: AUGUSTA_GREEN_DEEP,
              borderLeft: '1px solid rgba(0,0,0,0.20)',
              flexShrink: 0,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.50)',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Totals row ───────────────────────────────────────────────────────────────
export function TotalsRow({ participants, holePars, holeCount, coursePar, getScores, diffStr = () => '—', diffColor = null, playerTeam = () => null, netMode, netTotal, isMatchPlay, matchPlayData, isP1, PLAYER_COL, AVATAR_COL = 48, NAME_COL = 84, HOLE_COL, SUB_COL }) {
  // Augusta-style: dark green strip with white block-letter "TOTALS" + numbers
  return (
    <div style={{ background: AUGUSTA_GREEN, borderTop: '2px solid ' + AUGUSTA_WOOD }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
        background: AUGUSTA_GREEN_DEEP,
        width: 'max-content', minWidth: '100%',
      }}>
        <div style={{
          minWidth: PLAYER_COL, width: PLAYER_COL, padding: '8px 10px',
          fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT,
          fontFamily: '"Arial Black", Arial, sans-serif',
          letterSpacing: '0.06em', flexShrink: 0,
          position: 'sticky', left: 0, zIndex: 2, background: AUGUSTA_GREEN_DEEP,
        }}>TOTALS</div>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{ minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center', fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT, letterSpacing: '0.05em', flexShrink: 0 }}>
            {netMode ? 'NET' : isMatchPlay ? 'HOLES' : 'TOT'}
          </div>
          <div style={{ minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center', fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT, letterSpacing: '0.05em', flexShrink: 0 }}>
            {isMatchPlay ? 'STATUS' : '+/−'}
          </div>
          <div style={{ minWidth: 52, textAlign: 'center', fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT, letterSpacing: '0.05em', flexShrink: 0 }}>THRU</div>
        </div>
      </div>
      {participants.map((p) => {
        const sc          = getScores(p)
        const team        = perPlayer(playerTeam, p.user_id)
        const gross       = sc.reduce((s, v) => s + (v || 0), 0)
        const displayTot  = netMode ? (netTotal?.(p) ?? gross) : gross
        const holesPlayed = sc.filter(v => v > 0).length
        const dStr        = String(perPlayer(diffStr, p) ?? '—')
        const parts       = (p.name || '').trim().split(/\s+/)
        const display     = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').toUpperCase().slice(0, 12)

        // Match play status for this player
        let mpStatus = null
        if (isMatchPlay && matchPlayData) {
          const p1 = isP1?.(p)
          const up = p1 ? matchPlayData.p1HolesUp : -matchPlayData.p1HolesUp
          mpStatus = up === 0 ? 'AS' : up > 0 ? `${up} UP` : `${Math.abs(up)} DN`
        }
        const mpStatusColor = isMatchPlay && matchPlayData
          ? (isP1?.(p)
            ? (matchPlayData.p1HolesUp > 0 ? '#FFD700' : matchPlayData.p1HolesUp < 0 ? '#FFB4B4' : '#fff')
            : (matchPlayData.p1HolesUp < 0 ? '#FFD700' : matchPlayData.p1HolesUp > 0 ? '#FFB4B4' : '#fff'))
          : '#fff'

        const mpHolesWon = isMatchPlay && matchPlayData
          ? matchPlayData.holeResults.filter(r => r !== null && (isP1?.(p) ? r === 'p1' : r === 'p2')).length
          : null

        // Score-to-par "+/-" color: gold when under, red-ish over
        const dParsed = parseInt(dStr.replace(/[^\d-]/g, '')) || 0
        const dColor  = !holesPlayed ? 'rgba(255,255,255,0.55)'
                      : dStr === 'E' ? '#fff'
                      : dParsed < 0 ? '#FFD700'
                      : '#FFB4B4'

        const totalsRowH = 56
        return (
          <div key={p.user_id} style={{
            display: 'flex', alignItems: 'center',
            borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
            background: AUGUSTA_GREEN,
            width: 'max-content', minWidth: '100%',
          }}>
            {/* Rank column removed 2026-07-17 (Matt) — fixed row order on the
                scorecard/totals; the BOARD owns standings. Leader still gets
                the gold name accent below. */}
            {/* Avatar cell — photo fills edge-to-edge on the dark green strip (sticky) */}
            <div style={{
              minWidth: AVATAR_COL, width: AVATAR_COL, height: totalsRowH,
              flexShrink: 0,
              position: 'sticky', left: 0, zIndex: 2,
              borderRight: '1px solid ' + AUGUSTA_GREEN_DEEP,
              background: AUGUSTA_GREEN_DEEP,
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {p.avatar ? (
                <img
                  src={p.avatar}
                  alt={p.name}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'top center',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: avatarBg(p.name),
                  color: '#fff',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  fontSize: Math.round(totalsRowH * 0.36), fontWeight: 900,
                }}>{initials(p.name)}</div>
              )}
            </div>
            {/* Name cell (sticky w/ opaque bg — 2026-07-17 audit) */}
            <div style={{
              minWidth: NAME_COL, width: NAME_COL, height: totalsRowH,
              padding: '0 10px', flexShrink: 0,
              display: 'flex', alignItems: 'center',
              position: 'sticky', left: AVATAR_COL, zIndex: 2,
              background: AUGUSTA_GREEN,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 900, color: AUGUSTA_TEXT,
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '0.04em',
                }}>{display}</div>
                {team && <div style={{ fontSize: 10, color: 'rgba(26,107,40,0.65)', fontWeight: 700, marginTop: 2 }}>{team.name}</div>}
                {netMode && p.handicap != null && !p.is_guest && (
                  <div style={{ fontSize: 9, color: AUGUSTA_GOLD_DIM, fontWeight: 700, marginTop: 1 }}>HCP {p.handicap}</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{
                minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center',
                fontSize: 18, fontWeight: 900, color: AUGUSTA_TEXT, flexShrink: 0,
                fontFamily: '"Arial Black", Arial, sans-serif',
              }}>
                {isMatchPlay ? (mpHolesWon ?? '—') : (displayTot || '—')}
              </div>
              <div style={{
                minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center',
                fontSize: isMatchPlay ? 13 : 16, fontWeight: 900,
                color: isMatchPlay ? mpStatusColor : dColor,
                fontFamily: '"Arial Black", Arial, sans-serif', flexShrink: 0,
              }}>
                {isMatchPlay ? (matchPlayData?.played > 0 ? mpStatus : '—') : (holesPlayed ? dStr : '—')}
              </div>
              <div style={{
                minWidth: 52, textAlign: 'center', fontSize: 14, fontWeight: 800,
                color: 'rgba(26,107,40,0.85)', flexShrink: 0,
              }}>
                {holesPlayed || '—'}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
