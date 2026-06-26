// Own-club distance model for Eagle Eye bag arcs (Phase 3.3). Pure, no DOM/IO,
// so it unit-tests in Node. Turns the user's bag (possibly empty/sparse) into a
// full set of club distances + dispersion zones, seeded so the feature is
// useful from hole 1 — anchored to the user's OWN known club (gender-agnostic;
// no gender is stored), with a handicap baseline only when the bag is empty.
//
// Honesty: every seeded/filled club is flagged `estimated:true`. Distances are
// AVERAGES (typical total/resting yards), never a precise "to the flag" number.
// Sources: our own compilation of public tracked-shot datasets (Shot Scope /
// Arccos / Trackman consolidations). See own-club-arcs-3.3 build spec.

// Per-slot gapping ratio vs the 7-iron (= 1.00). Absolute yards come from the
// anchor (a real club, or the handicap baseline), so only the SPACING matters.
// Putter intentionally absent (no meaningful full-swing distance).
export const CLUB_GAP_RATIOS = {
  driver: 1.53, '3w': 1.40, '5w': 1.33, '7w': 1.26,
  hybrid_1: 1.28, hybrid_2: 1.20,
  iron_3: 1.25, iron_4: 1.18, iron_5: 1.10, iron_6: 1.05, iron_7: 1.00,
  iron_8: 0.94, iron_9: 0.88, pw: 0.79, gw: 0.68, sw: 0.55, lw: 0.48,
}

export const SLOT_LABELS = {
  driver: 'Driver', '3w': '3W', '5w': '5W', '7w': '7W',
  hybrid_1: 'H', hybrid_2: 'H2',
  iron_3: '3i', iron_4: '4i', iron_5: '5i', iron_6: '6i', iron_7: '7i',
  iron_8: '8i', iron_9: '9i', pw: 'PW', gw: 'GW', sw: 'SW', lw: 'LW',
}

// 1-SD dispersion ≈ 5% of distance (public working model); short-skew because
// amateurs miss short more than long. Used by the renderer to draw a ZONE, not
// a precise arc.
export const DISP_SD = 0.05
export const DISP_SHORT_SKEW = 1.3

// Reference 7-iron carry by handicap (zero-club fallback only). Anchor points
// from public skill→distance data; linear-interpolated + clamped.
const REF7I_BY_HCP = [[0, 168], [5, 164], [10, 160], [15, 154], [20, 144], [25, 132], [30, 120]]
export function ref7iFromHandicap(handicap) {
  const h = Number.isFinite(Number(handicap)) ? Number(handicap) : 15
  const pts = REF7I_BY_HCP
  if (h <= pts[0][0]) return pts[0][1]
  if (h >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
  for (let i = 1; i < pts.length; i++) {
    if (h <= pts[i][0]) {
      const [h0, y0] = pts[i - 1], [h1, y1] = pts[i]
      return Math.round(y0 + ((y1 - y0) * (h - h0)) / (h1 - h0))
    }
  }
  return 154
}

const num = (v) => (v == null || v === '' ? NaN : Number(v))
const median = (arr) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// The anchor reference 7i-equivalent yards: median of (realClub yards / its
// ratio) across the user's real clubs; falls back to the handicap baseline when
// the bag has no usable real club.
export function anchorRef(realClubs = [], handicap) {
  const implied = []
  for (const c of realClubs) {
    const r = CLUB_GAP_RATIOS[c?.slot]
    const y = num(c?.avg_yards)
    if (r && Number.isFinite(y) && y > 0) implied.push(y / r)
  }
  return implied.length ? median(implied) : ref7iFromHandicap(handicap)
}

// Full effective bag: real clubs (estimated:false) win; every other swing slot
// is filled from the anchor (estimated:true). Sorted longest → shortest.
export function effectiveBag(realClubs = [], handicap) {
  const ref = anchorRef(realClubs, handicap)
  const bySlot = new Map()
  for (const c of realClubs) {
    const y = num(c?.avg_yards)
    if (c?.slot && c.slot !== 'putter' && Number.isFinite(y) && y > 0) {
      bySlot.set(c.slot, { slot: c.slot, label: SLOT_LABELS[c.slot] ?? c.slot, yards: Math.round(y), estimated: false })
    }
  }
  for (const slot of Object.keys(CLUB_GAP_RATIOS)) {
    if (!bySlot.has(slot)) {
      bySlot.set(slot, { slot, label: SLOT_LABELS[slot] ?? slot, yards: Math.round(ref * CLUB_GAP_RATIOS[slot]), estimated: true })
    }
  }
  return [...bySlot.values()].filter(c => c.yards > 0).sort((a, b) => b.yards - a.yards)
}

export function dispersionEllipse(yards) {
  const y = Math.max(0, Number(yards) || 0)
  const semi = Math.max(4, y * DISP_SD) // floor so short clubs still show a zone
  return { depthYds: semi, widthYds: semi, shortSkew: DISP_SHORT_SKEW }
}

// The 1–2 clubs that bracket a target distance (declutter selector): the
// shortest club that still reaches at/over the target, plus the next one under
// it. Returns nearest single club at the extremes.
export function clubsForTarget(bag = [], targetYards) {
  const t = Number(targetYards)
  const usable = bag.filter(c => c.slot !== 'putter' && Number.isFinite(c.yards) && c.yards > 0)
                    .sort((a, b) => a.yards - b.yards) // shortest → longest
  if (!usable.length || !Number.isFinite(t)) return usable.slice(0, 1)
  const over = usable.find(c => c.yards >= t)            // shortest club that reaches
  if (!over) return [usable[usable.length - 1]]          // target beyond longest
  const idx = usable.indexOf(over)
  const under = idx > 0 ? usable[idx - 1] : null          // next one under
  return under ? [over, under] : [over]
}
