// BagPhoto — stylized SVG illustration of a golf bag with the user's
// selected clubs sticking out of the top. Each filled slot becomes a
// shaft + a head shape (driver/wood/hybrid/iron/wedge/putter, each
// drawn differently) emerging from the bag opening, sorted by typical
// height (longest at the back, shortest at the front). Brand label
// hovers above each club.
//
// Pure SVG, no API calls. Reuses the gold/green palette so it feels
// in-family with the rest of the app.
//
// (2026-05-01 — Matt asked: "can AI generate a photo of what your bag
// looks like." Picked option B = stylized illustration over real
// AI-generated photo.)

import { SLOT_LABELS } from '../lib/clubCatalog.js'

// Visual ordering: tallest clubs at the back, shortest at the front so
// the "fan" reads naturally left-to-right.
const SLOT_ORDER = [
  'driver', '3w', '5w', '7w',
  'hybrid_1', 'hybrid_2',
  'iron_3', 'iron_4', 'iron_5', 'iron_6', 'iron_7', 'iron_8', 'iron_9',
  'pw', 'gw', 'sw', 'lw',
  'putter',
]

// Approximate shaft length per club type, in viewBox units. Driver
// longest, putter shortest. Numbers are tuned visually, not to scale.
const SHAFT_HEIGHT = {
  driver:   220,
  '3w':     205,
  '5w':     195,
  '7w':     188,
  hybrid_1: 178,
  hybrid_2: 172,
  iron_3:   165,
  iron_4:   160,
  iron_5:   155,
  iron_6:   150,
  iron_7:   145,
  iron_8:   140,
  iron_9:   135,
  pw:       128,
  gw:       122,
  sw:       118,
  lw:       114,
  putter:   135, // mid-length but distinct head
}

function categoryFor(slot) {
  if (slot === 'driver' || slot.endsWith('w')) return 'wood'
  if (slot.startsWith('hybrid')) return 'hybrid'
  if (slot.startsWith('iron')) return 'iron'
  if (['pw', 'gw', 'sw', 'lw'].includes(slot)) return 'wedge'
  if (slot === 'putter') return 'putter'
  return 'iron'
}

// Each head is drawn relative to its top-of-shaft anchor (cx, cy).
function ClubHead({ slot, cx, cy }) {
  const cat = categoryFor(slot)
  if (cat === 'wood') {
    // Driver / fairway: rounded teardrop head
    return (
      <g>
        <ellipse cx={cx + 6} cy={cy - 6} rx={slot === 'driver' ? 14 : 11} ry={slot === 'driver' ? 11 : 9}
          fill="url(#bp-wood)" stroke="#C9A040" strokeWidth="0.5" />
        {/* Face line */}
        <line x1={cx - 5} y1={cy - 8} x2={cx + 1} y2={cy - 14}
          stroke="rgba(245,215,138,0.7)" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    )
  }
  if (cat === 'hybrid') {
    return (
      <g>
        <ellipse cx={cx + 5} cy={cy - 5} rx="9" ry="7"
          fill="url(#bp-wood)" stroke="#C9A040" strokeWidth="0.5" />
      </g>
    )
  }
  if (cat === 'iron' || cat === 'wedge') {
    // Blade with a slight angle
    const angle = cat === 'wedge' ? 18 : 10
    return (
      <g transform={`rotate(${angle}, ${cx}, ${cy})`}>
        <rect x={cx - 1} y={cy - 14} width="13" height="3.5"
          rx="0.6" fill="url(#bp-iron)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.3" />
        {/* Hosel */}
        <line x1={cx} y1={cy - 14} x2={cx} y2={cy - 4}
          stroke="#aaa" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    )
  }
  // Putter: mallet-style rectangle
  return (
    <g>
      <rect x={cx - 6} y={cy - 8} width="18" height="6" rx="1.2"
        fill="url(#bp-putter)" stroke="rgba(245,215,138,0.5)" strokeWidth="0.4" />
      <line x1={cx + 3} y1={cy - 8} x2={cx + 3} y2={cy - 2}
        stroke="rgba(255,255,255,0.4)" strokeWidth="0.6" />
    </g>
  )
}

export default function BagPhoto({ clubs = [], userName = null }) {
  // Map slot → club for quick lookup; iterate in canonical order so the
  // visual ordering is stable regardless of insert order.
  const bySlot = Object.fromEntries(clubs.map(c => [c.slot, c]))
  const filled = SLOT_ORDER.filter(s => bySlot[s])

  if (filled.length === 0) {
    // Empty bag: just the bag silhouette with a subtle prompt
    return <BagShell empty />
  }

  // Distribute clubs across the bag opening width. Bag opening spans
  // roughly x=70 to x=290 (viewBox 0..360). Leave a little margin.
  const xStart = 90
  const xEnd   = 270
  const N      = filled.length
  const span   = xEnd - xStart
  const step   = N > 1 ? span / (N - 1) : 0

  return (
    <BagShell userName={userName}>
      {/* Clubs sit at the bag opening (y ~= 230) and extend upward. */}
      {filled.map((slot, i) => {
        const club  = bySlot[slot]
        const x     = N === 1 ? (xStart + xEnd) / 2 : xStart + i * step
        const yTop  = 230 - SHAFT_HEIGHT[slot]
        const yBot  = 230
        return (
          <g key={slot}>
            {/* Shaft */}
            <line x1={x} y1={yBot} x2={x} y2={yTop}
              stroke="url(#bp-shaft)" strokeWidth="1.6" strokeLinecap="round" />
            {/* Head */}
            <ClubHead slot={slot} cx={x} cy={yTop} />
            {/* Brand label, alternates above heads with subtle offset
                to reduce overlap on densely-filled bags */}
            <text
              x={x + 6}
              y={yTop - (categoryFor(slot) === 'wood' ? 22 : 18)}
              fontSize="7"
              fontWeight="700"
              fill="#F5D78A"
              textAnchor="middle"
              style={{ letterSpacing: '0.04em' }}
            >
              {SLOT_LABELS[slot]?.replace(' Wedge', 'W').replace(' Iron', 'i').replace(' Wood', 'W')}
            </text>
            <text
              x={x + 6}
              y={yTop - (categoryFor(slot) === 'wood' ? 14 : 10)}
              fontSize="5.5"
              fontWeight="600"
              fill="rgba(255,255,255,0.55)"
              textAnchor="middle"
            >
              {(club.brand || '').slice(0, 12)}
            </text>
          </g>
        )
      })}
    </BagShell>
  )
}

// ─── Bag silhouette ──────────────────────────────────────────────────────────
function BagShell({ children, empty = false, userName = null }) {
  return (
    <div style={{
      borderRadius: 16, padding: 8,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.30))',
      border: '1px solid rgba(201,160,64,0.40)',
      boxShadow: '0 4px 22px rgba(13,31,18,0.10)',
    }}>
      <svg viewBox="0 0 360 540" style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="bp-bag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#1B5E3B" />
            <stop offset="55%" stopColor="#0E1F13" />
            <stop offset="100%" stopColor="#070C09" />
          </linearGradient>
          <linearGradient id="bp-bag-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="rgba(0,0,0,0.30)" />
            <stop offset="35%" stopColor="rgba(255,255,255,0)" />
            <stop offset="65%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.30)" />
          </linearGradient>
          <linearGradient id="bp-trim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#F5E070" />
            <stop offset="50%" stopColor="#C9A040" />
            <stop offset="100%" stopColor="#7A5800" />
          </linearGradient>
          <linearGradient id="bp-shaft" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#E8E8EC" />
            <stop offset="50%" stopColor="#A8A8B0" />
            <stop offset="100%" stopColor="#777" />
          </linearGradient>
          <linearGradient id="bp-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#222" />
            <stop offset="100%" stopColor="#070C09" />
          </linearGradient>
          <linearGradient id="bp-iron" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#E0E0E5" />
            <stop offset="100%" stopColor="#888" />
          </linearGradient>
          <linearGradient id="bp-putter" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#0a0a0a" />
          </linearGradient>
          <radialGradient id="bp-floor" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%"  stopColor="rgba(0,0,0,0.40)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        {/* Floor shadow */}
        <ellipse cx="180" cy="510" rx="120" ry="14" fill="url(#bp-floor)" />

        {/* Bag body — slightly tapered, taller version of a tour bag.
            Keep below the clubs (drawn after shadow, before clubs). */}
        <path
          d="
            M 80 230
            L 96 500
            Q 96 514 110 514
            L 250 514
            Q 264 514 264 500
            L 280 230
            Q 280 215 264 215
            L 96 215
            Q 80 215 80 230
            Z
          "
          fill="url(#bp-bag)"
        />
        {/* Side shading overlay */}
        <path
          d="
            M 80 230
            L 96 500
            Q 96 514 110 514
            L 250 514
            Q 264 514 264 500
            L 280 230
            Q 280 215 264 215
            L 96 215
            Q 80 215 80 230
            Z
          "
          fill="url(#bp-bag-side)"
        />

        {/* Top opening rim — a darker hollow band */}
        <ellipse cx="180" cy="222" rx="100" ry="14" fill="#050908" stroke="rgba(245,215,138,0.40)" strokeWidth="1" />
        <ellipse cx="180" cy="220" rx="96" ry="11" fill="#0A1410" />

        {/* Gold trim ring around the top */}
        <path
          d="M 84 222 Q 180 260 276 222"
          fill="none" stroke="url(#bp-trim)" strokeWidth="2.5" strokeLinecap="round"
        />

        {/* Strap (diagonal) */}
        <path
          d="M 100 290 Q 180 330 268 350"
          stroke="rgba(245,215,138,0.55)" strokeWidth="3" fill="none" strokeLinecap="round"
        />

        {/* Side pocket */}
        <rect x="108" y="380" width="144" height="58" rx="8"
          fill="rgba(255,255,255,0.04)" stroke="rgba(245,215,138,0.30)" strokeWidth="1" />

        {/* Logo plate — gold pill with "The Match" */}
        <rect x="124" y="452" width="112" height="22" rx="11"
          fill="url(#bp-trim)" />
        <text x="180" y="466" textAnchor="middle"
          fontSize="9" fontWeight="900" fill="#070C09"
          style={{ letterSpacing: '0.10em' }}>
          THE MATCH
        </text>

        {/* Owner name above logo (when given) */}
        {userName && (
          <text x="180" y="436" textAnchor="middle"
            fontSize="8" fontWeight="700" fill="rgba(245,215,138,0.65)"
            style={{ letterSpacing: '0.18em' }}>
            {userName.toUpperCase()}'S BAG
          </text>
        )}

        {/* Clubs (drawn on top of everything else) */}
        {children}

        {/* Empty-state hint */}
        {empty && (
          <text x="180" y="120" textAnchor="middle"
            fontSize="11" fontWeight="700" fill="rgba(13,31,18,0.45)">
            Add clubs below to see your bag
          </text>
        )}
      </svg>
    </div>
  )
}
