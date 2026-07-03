// Strokes Gained baseline tables (docs/SG-DESIGN.md).
//
// A baseline maps (lie, startDistance) → expected strokes to hole out.
// Tour anchors follow Mark Broadie's published PGA Tour expected-strokes
// tables ("Every Shot Counts" / the methodology behind the PGA Tour's
// Strokes Gained statistics). Distances are YARDS for off-green lies and
// FEET for the green.
//
// Amateur (handicap-band) tables are v1 APPROXIMATIONS derived from the
// tour anchors via per-lie scaling + putting offsets, tuned so the
// aggregate 18-hole gap vs tour matches observed scoring gaps
// (scratch ≈ +3.5, 5 ≈ +8, 10 ≈ +13, 15 ≈ +18.5, 20 ≈ +24).
// They are deliberately data, not code: replace with fitted tables
// (or our own user-derived baselines) without touching the math.
// See SG-DESIGN.md "Open questions".
//
// IP note: methodology + category names are Broadie's published, freely
// usable framework. No PGA Tour ShotLink data is used or implied.

// ── Tour anchors ─────────────────────────────────────────────────────────────
// [distance, expectedStrokes] — interpolated linearly, clamped at the ends.

const TOUR = {
  // yards (par-4/5 tee shots)
  tee: [
    [100, 2.92], [120, 2.99], [140, 2.97], [160, 2.99], [180, 3.05],
    [200, 3.12], [220, 3.17], [240, 3.25], [260, 3.45], [280, 3.65],
    [300, 3.71], [320, 3.79], [340, 3.86], [360, 3.92], [380, 3.96],
    [400, 3.99], [420, 4.02], [440, 4.08], [460, 4.17], [480, 4.28],
    [500, 4.41], [520, 4.54], [540, 4.65], [560, 4.74], [580, 4.79],
    [600, 4.82],
  ],
  // yards
  fairway: [
    [10, 2.18], [20, 2.40], [40, 2.60], [60, 2.70], [80, 2.75],
    [100, 2.80], [120, 2.85], [140, 2.91], [160, 2.98], [180, 3.08],
    [200, 3.19], [220, 3.32], [240, 3.45], [260, 3.58], [280, 3.69],
    [300, 3.78], [320, 3.84], [350, 3.92],
  ],
  // yards
  rough: [
    [10, 2.34], [20, 2.59], [40, 2.78], [60, 2.91], [80, 2.96],
    [100, 3.02], [120, 3.08], [140, 3.15], [160, 3.23], [180, 3.31],
    [200, 3.42], [220, 3.53], [240, 3.64], [260, 3.74], [280, 3.83],
    [300, 3.90], [320, 3.95], [350, 4.02],
  ],
  // yards
  sand: [
    [10, 2.43], [20, 2.53], [40, 2.82], [60, 3.15], [80, 3.24],
    [100, 3.23], [120, 3.21], [140, 3.22], [160, 3.28], [180, 3.40],
    [200, 3.55], [220, 3.70], [240, 3.84], [260, 3.93], [280, 4.00],
    [300, 4.04],
  ],
  // yards — trouble lies (trees, hazard drops). Sparse by nature.
  recovery: [
    [60, 3.56], [100, 3.80], [140, 4.00], [180, 4.20], [220, 4.30],
    [260, 4.40], [300, 4.50],
  ],
  // FEET
  green: [
    [1, 1.001], [2, 1.009], [3, 1.053], [4, 1.13], [5, 1.23],
    [6, 1.34], [7, 1.42], [8, 1.50], [10, 1.61], [15, 1.78],
    [20, 1.87], [25, 1.93], [30, 1.98], [40, 2.06], [50, 2.14],
    [60, 2.21], [90, 2.40],
  ],
}

// ── Handicap bands (v1 approximation model, SELF-CALIBRATING) ───────────────
// Off-green lies: E_band = E_tour × mult(lie). Putting: E_band = E_tour +
// offset(distFt) where the offset ramps from 0 inside 3 ft to `puttCap`
// beyond 40 ft.
//
// Calibration: the RAW multiplier deltas below define only the relative
// SHAPE of where a band loses strokes (sand worst, tee least — long game
// carries ~2/3 of the gap, Broadie). At module load, each band's off-green
// deltas are scaled so the 18-hole reference-round gap vs tour
// (roundGapVsTour) lands EXACTLY on gapTarget. Replace the whole model with
// fitted tables later without touching any caller.

const RAW_BANDS = {
  scratch: { gapTarget: 3.5,  tee: 1.030, fairway: 1.030, rough: 1.035, sand: 1.045, recovery: 1.03, puttCap: 0.06 },
  'hcp-5':  { gapTarget: 8.0,  tee: 1.065, fairway: 1.070, rough: 1.080, sand: 1.100, recovery: 1.07, puttCap: 0.13 },
  'hcp-10': { gapTarget: 13.0, tee: 1.105, fairway: 1.115, rough: 1.130, sand: 1.165, recovery: 1.12, puttCap: 0.20 },
  'hcp-15': { gapTarget: 18.5, tee: 1.150, fairway: 1.165, rough: 1.185, sand: 1.235, recovery: 1.17, puttCap: 0.28 },
  'hcp-20': { gapTarget: 24.0, tee: 1.200, fairway: 1.220, rough: 1.250, sand: 1.310, recovery: 1.23, puttCap: 0.36 },
}

const OFF_GREEN_LIES = ['tee', 'fairway', 'rough', 'sand', 'recovery']
const BANDS = {} // populated by calibrate() below

const LIES = ['tee', 'fairway', 'rough', 'sand', 'recovery', 'green']

function interp(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1]
  const last = anchors[anchors.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1]
    const [x2, y2] = anchors[i]
    if (x <= x2) return y1 + ((x - x1) / (x2 - x1)) * (y2 - y1)
  }
  return last[1] // unreachable
}

/** Putting offset for a band: 0 at ≤3 ft ramping linearly to `cap` at ≥40 ft. */
function puttOffset(cap, distFt) {
  if (distFt <= 3) return 0
  if (distFt >= 40) return cap
  return cap * ((distFt - 3) / 37)
}

// ── Calibration ──────────────────────────────────────────────────────────────
// Reference 18-hole round (par-72 shape): 14 driving holes, 4 par-3s,
// a normal mix of approaches/short game, 1.9-putt-ish tour greens.
const REFERENCE_ROUND = [
  { lie: 'tee', dist: 420, count: 14 },
  { lie: 'tee', dist: 175, count: 4 },
  { lie: 'fairway', dist: 155, count: 14 },
  { lie: 'rough', dist: 165, count: 2 },
  { lie: 'sand', dist: 20, count: 2 },
  { lie: 'fairway', dist: 25, count: 4 },
  { lie: 'green', dist: 20, count: 18 }, // first putts (ft)
  { lie: 'green', dist: 3, count: 18 },  // cleanup putts (ft)
]

const tourE = (lie, dist) => interp(TOUR[lie], dist)

// Scale each band's off-green multiplier deltas so the reference-round gap
// vs tour lands exactly on gapTarget (putting offsets are kept as authored;
// the long game absorbs the adjustment, which matches Broadie's split).
for (const [id, raw] of Object.entries(RAW_BANDS)) {
  let puttingGap = 0
  let offGreenGapRaw = 0
  for (const { lie, dist, count } of REFERENCE_ROUND) {
    if (lie === 'green') puttingGap += count * puttOffset(raw.puttCap, dist)
    else offGreenGapRaw += count * tourE(lie, dist) * (raw[lie] - 1)
  }
  const scale = (raw.gapTarget - puttingGap) / offGreenGapRaw
  const band = { puttCap: raw.puttCap, gapTarget: raw.gapTarget }
  for (const lie of OFF_GREEN_LIES) band[lie] = 1 + (raw[lie] - 1) * scale
  BANDS[id] = band
}

/** Baseline ids accepted everywhere ('auto' resolves via resolveBaseline). */
const BASELINE_IDS = ['tour', ...Object.keys(BANDS)]

/**
 * Expected strokes to hole out.
 * @param {string} baseline  'tour' | 'scratch' | 'hcp-5' | 'hcp-10' | 'hcp-15' | 'hcp-20'
 * @param {string} lie       tee|fairway|rough|sand|recovery|green
 * @param {number} dist      yards off the green; FEET on the green. 0 ⇒ holed ⇒ 0.
 */
function expectedStrokes(baseline, lie, dist) {
  if (!LIES.includes(lie)) throw new Error(`unknown lie: ${lie}`)
  if (!BASELINE_IDS.includes(baseline)) throw new Error(`unknown baseline: ${baseline}`)
  if (!(dist > 0)) return 0 // holed
  const tour = interp(TOUR[lie], dist)
  if (baseline === 'tour') return round3(tour)
  const band = BANDS[baseline]
  if (lie === 'green') return round3(tour + puttOffset(band.puttCap, dist))
  return round3(tour * band[lie])
}

/** Map a handicap index to the nearest band id (the 'auto' toggle setting). */
function bandForHandicap(index) {
  if (index == null || !Number.isFinite(Number(index))) return 'hcp-15' // unknown → modest default
  const h = Number(index)
  if (h <= 2) return 'scratch'
  if (h <= 7.5) return 'hcp-5'
  if (h <= 12.5) return 'hcp-10'
  if (h <= 17.5) return 'hcp-15'
  return 'hcp-20'
}

/** Resolve a user-facing baseline setting ('auto' | id) to a concrete id. */
function resolveBaseline(setting, handicapIndex) {
  if (setting && setting !== 'auto' && BASELINE_IDS.includes(setting)) return setting
  return bandForHandicap(handicapIndex)
}

/** Expected 18-hole score gap vs tour for a band. Exact by construction —
 *  the calibration above scales each band to land on its gapTarget over the
 *  REFERENCE_ROUND. Used by the phase-1 SG:Total estimate. */
function roundGapVsTour(baseline) {
  if (baseline === 'tour') return 0
  const band = BANDS[baseline]
  if (!band) throw new Error(`unknown baseline: ${baseline}`)
  return band.gapTarget
}

function round3(x) { return Math.round(x * 1000) / 1000 }

module.exports = {
  expectedStrokes,
  resolveBaseline,
  bandForHandicap,
  roundGapVsTour,
  BASELINE_IDS,
  LIES,
}
