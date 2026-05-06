// ─── Outing/shared.jsx ────────────────────────────────────────────────────
// Shared theme constants + small helpers + PlayerAvatar — extracted from
// the original 7600-line Outing.jsx (2026-05-06) so each child component
// can import what it needs without circular references back to the
// top-level. Pure mechanical move; no behavior change.

// ─── Augusta theme palette ───────────────────────────────────────────────
// TRANSLUCENT MODE (round 13b): every surface translucent so the page
// fairway grass shows through clearly. Solid colors only on numerals,
// gold accents, and red under-par for readability.
export const AUGUSTA_GREEN       = 'rgba(255,255,255,0.55)'   // frame stripe panels
export const AUGUSTA_GREEN_DEEP  = 'rgba(232,232,232,0.55)'   // deepest panel (OUT/IN strip + headers)
export const AUGUSTA_PANEL       = 'rgba(255,255,255,0.55)'   // main board panel
export const AUGUSTA_PANEL_HI    = 'rgba(255,255,255,0.62)'   // gradient top
export const AUGUSTA_PANEL_HOVER = 'rgba(240,240,240,0.62)'   // me-row tint
export const AUGUSTA_TEXT        = '#1A6B28'   // green text — stays solid for legibility
export const AUGUSTA_GOLD        = '#E8C05A'   // PAR + leader accents — solid
export const AUGUSTA_GOLD_DIM    = '#A8862E'   // pinstripe — solid
export const AUGUSTA_CREAM       = 'rgba(234,224,191,0.55)'   // LEADERS banner cream — translucent
export const AUGUSTA_TILE        = 'rgba(242,235,211,0.65)'   // score tile cream — translucent
export const AUGUSTA_RED         = '#B22222'   // under-par red — solid
export const AUGUSTA_INK         = '#0F0F0F'   // over-par ink — solid
export const AUGUSTA_WOOD        = 'rgba(90,58,22,0.85)'      // wood frame — slight translucency

// Backwards-compat aliases — older code still referenced these names.
export const AUGUSTA_TEAL        = AUGUSTA_PANEL
export const AUGUSTA_TEAL_HOVER  = AUGUSTA_PANEL_HOVER

// ─── Helpers ──────────────────────────────────────────────────────────────
export function scoreColor(strokes, par) {
  if (!strokes || !par) return 'var(--tm-text-2)'
  const d = strokes - par
  if (d <= -2) return 'var(--tm-eagle)'
  if (d === -1) return 'var(--tm-birdie)'
  if (d === 0)  return 'var(--tm-par)'
  if (d === 1)  return 'var(--tm-bogey)'
  return 'var(--tm-double)'
}

export function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
}

// Deterministic avatar ring color from name — used for initials fallback.
// Same palette as the standalone AugustaBoard, colors that read on cream/teal.
export function avatarBg(name = '') {
  const palette = ['#1B5E20', '#0D47A1', '#6A1B9A', '#B71C1C', '#006064', '#E65100', '#33691E', '#4527A0']
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return palette[h % palette.length]
}

// PlayerAvatar — renders the user's profile photo if uploaded, otherwise
// a colored initials circle. Used in the scorecard player rows.
export function PlayerAvatar({ name = '', avatar = null, size = 30, ringColor = AUGUSTA_GREEN }) {
  const initialsStr = initials(name) || '·'
  const baseStyle = {
    width: size, height: size, borderRadius: '50%',
    flexShrink: 0,
    border: `2px solid ${ringColor}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
    overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: avatarBg(name),
    color: '#fff',
    fontFamily: '"Arial Black", Arial, sans-serif',
    fontSize: Math.round(size * 0.36), fontWeight: 900,
    letterSpacing: 0,
  }
  if (avatar) {
    return (
      <div style={{ ...baseStyle, background: AUGUSTA_TILE }}>
        <img
          src={avatar} alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    )
  }
  return <div style={baseStyle}>{initialsStr}</div>
}

export function wlLabel(w, l, t) {
  if (!w && !l && !t) return '—'
  return `${w}-${l}${t ? `-${t}` : ''}`
}

// Score-vs-par label used by the recent-event banner. Returns
// "HOLE-IN-ONE", "ALBATROSS", "EAGLE", "BIRDIE", "PAR", "BOGEY",
// "DOUBLE", "TRIPLE", or "+N". (2026-04-30 PM round 10)
//
// 2026-05-06 — added explicit HOLE-IN-ONE branch so a score of 1 on
// any par reads as 'HOLE-IN-ONE' instead of falling into ALBATROSS /
// EAGLE / BIRDIE based on raw diff. Matches the highlight share-card's
// badgeForScore logic (HighlightShare.jsx) so the recent-event banner
// at the top of LiveOuting and the celebration modal both call the
// moment by its proper name.
export function scoreLabel(score, par) {
  if (score === 1) return 'HOLE-IN-ONE'
  const d = score - par
  if (d <= -3) return 'ALBATROSS'
  if (d === -2) return 'EAGLE'
  if (d === -1) return 'BIRDIE'
  if (d === 0)  return 'PAR'
  if (d === 1)  return 'BOGEY'
  if (d === 2)  return 'DOUBLE'
  if (d === 3)  return 'TRIPLE'
  return `+${d}`
}

// "Today" / "Yesterday" / "Mar 12" — used by Recent Matches cards
export function relDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const ymd = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const diffMs = now - d
  if (ymd(d) === ymd(now)) return 'Today'
  const yest = new Date(now); yest.setDate(yest.getDate() - 1)
  if (ymd(d) === ymd(yest)) return 'Yesterday'
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Render a list of opponent names compactly: "Dale", "Dale + 2", or "—"
export function fmtOpponents(names) {
  const n = (names || []).filter(Boolean)
  if (n.length === 0) return null
  const first = n[0].split(' ')[0]
  if (n.length === 1) return first
  if (n.length === 2) return `${first} & ${n[1].split(' ')[0]}`
  return `${first} +${n.length - 1}`
}

// Tactile feedback at the moment a score is committed (or any other
// commit-style action). Short single-pulse vibrations only — long
// vibrations feel like errors. iOS Safari ignores navigator.vibrate
// entirely so this is a no-op on iPhone PWAs (the SavedChip flash is
// the visual fallback there); Android Chrome + most desktop browsers
// honor it. Guarded so it never throws on stricter contexts (e.g. when
// the page isn't user-activated). (2026-05-06 — Matt: haptic feedback
// on score entry, polish task #1)
export function tmHaptic(ms = 15) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms)
    }
  } catch { /* never let haptics break a save */ }
}

// Tap-to-copy a join code, with brief visual confirmation handled by the caller
export async function copyCode(code) {
  if (!code) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code)
      return true
    }
  } catch { /* fall through */ }
  // Fallback for older browsers / iOS PWA when clipboard API blocked
  try {
    const ta = document.createElement('textarea')
    ta.value = code
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch { return false }
}
