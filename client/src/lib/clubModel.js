// Own-club distance model for Eagle Eye bag arcs (Phase 3.3). Pure, no DOM/IO,
// so it unit-tests in Node.
//
// ACCURACY-FIRST (corrected 2026-06-25, Matt): we do NOT guess club distances.
// Handicap does not map to how far a player hits each club — that's a guess,
// and guessing violates the accuracy promise. We use ONLY the player's own
// entered averages from their bag (tm_user_clubs.avg_yards). When the bag has
// no distances, the UI prompts the player to set them — it never fabricates.

export const SLOT_LABELS = {
  driver: 'Driver', '3w': '3W', '5w': '5W', '7w': '7W',
  hybrid_1: 'H', hybrid_2: 'H2',
  iron_3: '3i', iron_4: '4i', iron_5: '5i', iron_6: '6i', iron_7: '7i',
  iron_8: '8i', iron_9: '9i', pw: 'PW', gw: 'GW', sw: 'SW', lw: 'LW',
}

// 1-SD dispersion ≈ 5% of distance (public working model); short-skew because
// amateurs miss short more than long. Used by the renderer to draw a ZONE (a
// "typical landing area"), not a precise arc.
export const DISP_SD = 0.05
export const DISP_SHORT_SKEW = 1.3

const num = (v) => (v == null || v === '' ? NaN : Number(v))

// The player's REAL bag: every swing club they've entered a distance for.
// No seeding, no extrapolation — entered data only. Sorted longest → shortest.
export function realBag(clubs = []) {
  const out = []
  for (const c of clubs) {
    const y = num(c?.avg_yards)
    if (c?.slot && c.slot !== 'putter' && Number.isFinite(y) && y > 0) {
      out.push({ slot: c.slot, label: SLOT_LABELS[c.slot] ?? c.slot, yards: Math.round(y) })
    }
  }
  return out.sort((a, b) => b.yards - a.yards)
}

export function dispersionEllipse(yards) {
  const y = Math.max(0, Number(yards) || 0)
  const semi = Math.max(4, y * DISP_SD) // floor so short clubs still show a zone
  return { depthYds: semi, widthYds: semi, shortSkew: DISP_SHORT_SKEW }
}

// Clubs to draw as DISTANCE ARCS across the hole (Phase 3.3, rebuilt 2026-06-26).
// Honest: the player's real entered clubs only. Given the distance remaining to
// the target, show the clubs that land within the hole (at/short of the target)
// PLUS the shortest club that covers it, highlight the best match for the shot,
// and thin to <=6 for a clean, premium read. remaining null/unknown → the whole
// bag (thinned). `bag` is the realBag() output ([{slot,label,yards}]).
const ARC_MAX = 6
export function arcClubs(bag = [], remainingYards = null) {
  const clubs = (bag || [])
    .filter(c => Number.isFinite(c?.yards) && c.yards > 0)
    .sort((a, b) => b.yards - a.yards) // long → short
  if (!clubs.length) return []

  const t = Number(remainingYards)
  let set, highlightYards = null
  if (Number.isFinite(t) && t > 0) {
    set = clubs.filter(c => c.yards <= t * 1.05) // land at/short of the target
    const cover = [...clubs].reverse().find(c => c.yards >= t) // shortest that covers it
    if (cover && !set.some(c => c.slot === cover.slot)) set.push(cover)
    set.sort((a, b) => b.yards - a.yards)
    let best = set[0], bd = Infinity
    for (const c of set) { const d = Math.abs(c.yards - t); if (d < bd) { bd = d; best = c } }
    highlightYards = best ? best.yards : null
  } else {
    set = clubs.slice()
  }

  // Thin to <=ARC_MAX, always keeping the longest, shortest, and highlight.
  if (set.length > ARC_MAX) {
    const keepIdx = new Set([0, set.length - 1])
    const hi = set.findIndex(c => c.yards === highlightYards)
    if (hi >= 0) keepIdx.add(hi)
    const step = (set.length - 1) / (ARC_MAX - 1)
    for (let i = 0; i < ARC_MAX; i++) keepIdx.add(Math.round(i * step))
    set = set.filter((_, i) => keepIdx.has(i)).sort((a, b) => b.yards - a.yards).slice(0, ARC_MAX)
  }

  return set.map(c => ({ slot: c.slot, label: c.label, yards: c.yards, highlight: c.yards === highlightYards }))
}

// The 1–2 clubs that bracket a target distance (declutter selector): the
// shortest club that still reaches at/over the target, plus the next one under
// it. Returns the nearest single club at the extremes.
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
