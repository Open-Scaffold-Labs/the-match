// Strokes Gained — core math (docs/SG-DESIGN.md).
//
// SG is NEVER persisted: rounds store facts (putt counts, first-putt
// distance buckets; later per-shot lie + toPin) and this module computes
// SG against any baseline at read time.
//
// Phase 1 scope (shipped here):
//   • SG: P     — from per-hole putt count + first-putt distance bucket
//   • SG: Total — round score vs the baseline's expected score
//   • SG: T2G   — Total − P (derived)
// Phase 2 adds per-shot OTT/APP/ARG from {lie, toPin} shot facts via
// shotSG(), which is already implemented + tested below.

const { expectedStrokes, resolveBaseline, roundGapVsTour, BASELINE_IDS } = require('./baselines')

// First-putt distance buckets (client chips) → representative feet.
// Midpoint-ish values, biased low (golfers overestimate putt length).
const FIRST_PUTT_BUCKETS = {
  'in3': 2,    // inside 3 ft
  '3-10': 6,
  '10-25': 16,
  '25plus': 35,
}

/**
 * Per-shot SG (phase 2 path, used by tests + future OTT/APP/ARG split).
 * @param {string} baseline concrete baseline id
 * @param {{lie:string, toPin:number}} shot           state BEFORE the shot
 * @param {{lie:string, toPin:number}|null} result    state AFTER (null ⇒ holed)
 * @param {number} [penalty=0]                        penalty strokes incurred
 */
function shotSG(baseline, shot, result, penalty = 0) {
  const before = expectedStrokes(baseline, shot.lie, shot.toPin)
  const after = result ? expectedStrokes(baseline, result.lie, result.toPin) : 0
  return round2(before - after - 1 - penalty)
}

/**
 * SG: Putting for one hole from putt count + first-putt bucket.
 * SG:P = E[first putt distance] − putts taken.
 * Returns null when the hole has no usable putt data (no fake numbers).
 */
function holePuttSG(baseline, putts, firstPuttBucket) {
  if (putts == null) return null // Number(null) === 0 — guard BEFORE coercion
  const n = Number(putts)
  if (!Number.isFinite(n) || n < 0) return null
  if (n === 0) return 0 // holed out from off the green — no putting SG either way
  const feet = FIRST_PUTT_BUCKETS[firstPuttBucket]
  if (!feet) return null
  return round2(expectedStrokes(baseline, 'green', feet) - n)
}

// ── Phase 2: per-shot category SG (OTT / APP / ARG) ──────────────────────────
// Conventions (PGA Tour / Broadie):
//   OTT — tee shot on a par 4/5 (par-3 tee shots belong to APP)
//   APP — off-green shots from > 30 yds that aren't OTT
//   ARG — off-green shots from ≤ 30 yds
//   P   — on the green (computed from putt facts, not the shot log)
const ARG_MAX_YDS = 30

/**
 * Category SG for ONE hole from its shot chain + putt facts.
 *
 * Data integrity gate: categories are computed ONLY when the chain is
 * complete — every logged shot has a valid lie + toPin, putt count is
 * present, and shots.length + putts === score. Anything else returns
 * null categories (no fake numbers); SG:P is handled separately.
 *
 * Units: toPin in YARDS off the green; the green handoff (last shot's
 * result = first putt) uses the bucket's representative FEET.
 *
 * Invariant (tested): OTT + APP + ARG + P === E[first shot] − score.
 */
/**
 * Walk ONE hole's complete shot chain → per-shot [{lie, toPin, category, sg}].
 * Returns null when the chain fails the integrity gate. The shared core of
 * holeShotsSG (category totals) and appBucketBreakdown (phase 3 — the AI
 * Caddie's "worst leak" detail).
 */
function walkChain(baseline, { par, score, shots, putts, firstPuttBucket }) {
  if (!Array.isArray(shots) || shots.length === 0) return null
  const p = Number(par)
  const s = Number(score)
  const n = putts == null ? null : Number(putts)
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0 || n == null || !Number.isFinite(n)) return null
  // Complete-chain gate.
  if (shots.length + n !== s) return null
  const OFF_GREEN = ['tee', 'fairway', 'rough', 'sand', 'recovery']
  for (const shot of shots) {
    if (!shot || !OFF_GREEN.includes(shot.lie) || !(Number(shot.toPin) > 0)) return null
  }
  // Last shot's result: first putt (bucket feet) or holed out.
  let lastResult = null // holed
  if (n > 0) {
    const feet = FIRST_PUTT_BUCKETS[firstPuttBucket]
    if (!feet) return null // putts taken but no first-putt distance → chain incomplete
    lastResult = { lie: 'green', toPin: feet }
  }
  const walked = []
  for (let i = 0; i < shots.length; i++) {
    const shot = { lie: shots[i].lie, toPin: Number(shots[i].toPin) }
    const result = i < shots.length - 1
      ? { lie: shots[i + 1].lie, toPin: Number(shots[i + 1].toPin) }
      : lastResult
    const sg = shotSG(baseline, shot, result)
    const category = (i === 0 && shot.lie === 'tee' && p >= 4) ? 'OTT'
      : shot.toPin <= ARG_MAX_YDS ? 'ARG'
      : 'APP'
    walked.push({ ...shot, category, sg })
  }
  return walked
}

function holeShotsSG(baseline, holeArgs) {
  const walked = walkChain(baseline, holeArgs)
  if (!walked) return { sgOTT: null, sgAPP: null, sgARG: null }
  const out = { sgOTT: 0, sgAPP: 0, sgARG: 0 }
  for (const w of walked) out[`sg${w.category}`] += w.sg
  return { sgOTT: round2(out.sgOTT), sgAPP: round2(out.sgAPP), sgARG: round2(out.sgARG) }
}

// ── Phase 3: APP shots by start-distance bucket (the Caddie's detail) ────────
const APP_BUCKETS = [
  { key: '30-75',   min: 31,  max: 75 },
  { key: '75-125',  min: 76,  max: 125 },
  { key: '125-150', min: 126, max: 150 },
  { key: '150-175', min: 151, max: 175 },
  { key: '175-200', min: 176, max: 200 },
  { key: '200+',    min: 201, max: Infinity },
]

/**
 * Per-shot APP SG grouped by start distance across rounds (complete chains
 * only). Returns [{bucket, shots, avgSG, totalSG}] sorted worst-first, or []
 * with no data. Feeds the AI Caddie prompt block ("worst: 150–175, −0.9").
 */
function appBucketBreakdown(rounds, baselineSetting, handicapIndex) {
  const baseline = resolveBaseline(baselineSetting, handicapIndex)
  const acc = new Map()
  for (const r of rounds) {
    const scores = Array.isArray(r.scores) ? r.scores : []
    const shotLogs = Array.isArray(r.shots) ? r.shots : []
    const holePars = Array.isArray(r.hole_pars) ? r.hole_pars : []
    const putts = Array.isArray(r.putts) ? r.putts : []
    const firstPutts = Array.isArray(r.first_putts) ? r.first_putts : []
    for (let i = 0; i < shotLogs.length; i++) {
      const walked = walkChain(baseline, {
        par: holePars[i] ?? 4, score: scores[i], shots: shotLogs[i],
        putts: putts[i], firstPuttBucket: firstPutts[i],
      })
      if (!walked) continue
      for (const w of walked) {
        if (w.category !== 'APP') continue
        const b = APP_BUCKETS.find(x => w.toPin >= x.min && w.toPin <= x.max)
        if (!b) continue
        const cur = acc.get(b.key) ?? { bucket: b.key, shots: 0, totalSG: 0 }
        cur.shots++; cur.totalSG += w.sg
        acc.set(b.key, cur)
      }
    }
  }
  return [...acc.values()]
    .map(x => ({ ...x, totalSG: round2(x.totalSG), avgSG: round2(x.totalSG / x.shots) }))
    .sort((a, b) => a.avgSG - b.avgSG) // worst first
}

/**
 * Round SG. Phase 1: Total / P / T2G from score + putt facts. Phase 2:
 * OTT / APP / ARG from per-hole shot chains where complete.
 * @param {object} round  { total, course_par, course_rating?, putts?, first_putts?,
 *                          scores?, shots?, hole_pars? }
 * @param {string} baselineSetting 'auto' | baseline id
 * @param {number|null} handicapIndex  for resolving 'auto'
 * @returns {{baseline, sgTotal, sgP, sgT2G, sgOTT, sgAPP, sgARG,
 *            puttHolesCounted, shotHolesCounted}|null}
 */
function roundSG(round, baselineSetting, handicapIndex) {
  const baseline = resolveBaseline(baselineSetting, handicapIndex)
  const total = Number(round.total)
  const par = Number(round.course_par)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(par) || par <= 0) return null

  // SG: Total — baseline expected score vs actual. Reference expectation:
  // tour expected ≈ par − 2 on a rating-less card (tour avg vs par on a
  // standard layout), band expectation = tour + calibrated gap. When the
  // round carries a course_rating, anchor on it instead of par.
  const tourExpected = Number(round.course_rating) > 0
    ? Number(round.course_rating) - 2
    : par - 2
  const expected = tourExpected + roundGapVsTour(baseline)
  const sgTotal = round2(expected - total)

  // SG: P — sum of per-hole putting SG over holes that carry putt data.
  const putts = Array.isArray(round.putts) ? round.putts : []
  const firstPutts = Array.isArray(round.first_putts) ? round.first_putts : []
  let sgP = 0
  let counted = 0
  for (let i = 0; i < putts.length; i++) {
    const sg = holePuttSG(baseline, putts[i], firstPutts[i])
    if (sg != null) { sgP += sg; counted++ }
  }
  const haveP = counted >= 9 // require at least half a round of putt data

  // Phase 2 — per-hole shot chains (lie + toPin). Holes with complete
  // chains contribute OTT/APP/ARG; partial logging is simply skipped.
  const scores = Array.isArray(round.scores) ? round.scores : []
  const shotLogs = Array.isArray(round.shots) ? round.shots : []
  const holePars = Array.isArray(round.hole_pars) ? round.hole_pars : []
  let ott = 0, app = 0, arg = 0, shotHoles = 0
  for (let i = 0; i < shotLogs.length; i++) {
    const cat = holeShotsSG(baseline, {
      par: holePars[i] ?? 4,
      score: scores[i],
      shots: shotLogs[i],
      putts: putts[i],
      firstPuttBucket: firstPutts[i],
    })
    if (cat.sgOTT != null) { ott += cat.sgOTT; app += cat.sgAPP; arg += cat.sgARG; shotHoles++ }
  }
  const haveShots = shotHoles >= 9
  const norm = v => round2(v * (18 / shotHoles))

  return {
    baseline,
    sgTotal,
    sgP: haveP ? round2(sgP * (18 / counted)) : null, // normalize partials to 18 holes
    sgT2G: haveP ? round2(sgTotal - sgP * (18 / counted)) : null,
    sgOTT: haveShots ? norm(ott) : null,
    sgAPP: haveShots ? norm(app) : null,
    sgARG: haveShots ? norm(arg) : null,
    puttHolesCounted: counted,
    shotHolesCounted: shotHoles,
  }
}

/**
 * Aggregate SG across rounds (most recent first). Skips rounds that produce
 * no SG. Returns per-category means + per-round series for trend charts.
 */
function aggregateSG(rounds, baselineSetting, handicapIndex) {
  const perRound = []
  for (const r of rounds) {
    const sg = roundSG(r, baselineSetting, handicapIndex)
    if (sg) perRound.push({ id: r.id, date: r.date, ...sg })
  }
  const mean = key => {
    const vals = perRound.map(r => r[key]).filter(v => v != null)
    return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null
  }
  return {
    baseline: perRound[0]?.baseline ?? resolveBaseline(baselineSetting, handicapIndex),
    rounds: perRound.length,
    roundsWithPutting: perRound.filter(r => r.sgP != null).length,
    roundsWithShots: perRound.filter(r => r.sgOTT != null).length,
    sgTotal: mean('sgTotal'),
    sgP: mean('sgP'),
    sgT2G: mean('sgT2G'),
    sgOTT: mean('sgOTT'),
    sgAPP: mean('sgAPP'),
    sgARG: mean('sgARG'),
    series: perRound,
  }
}

function round2(x) { return Math.round(x * 100) / 100 }

// ── Phase 3: the AI prompt block ─────────────────────────────────────────────
// The compact SG profile the Caddie / Eagle Eye system prompt receives
// (docs/SG-DESIGN.md "AI Caddie contract"). Pure formatting over aggregateSG +
// appBucketBreakdown — callers fetch the rounds. Returns null when there's no
// SG signal at all (the prompt simply omits the block; never fabricate).
function sgPromptBlock(rounds, baselineSetting, handicapIndex) {
  if (!Array.isArray(rounds) || rounds.length === 0) return null
  const agg = aggregateSG(rounds, baselineSetting, handicapIndex)
  if (!agg.rounds || agg.sgTotal == null) return null
  const fmt = v => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
  const parts = [`Total ${fmt(agg.sgTotal)}`]
  if (agg.sgOTT != null) parts.push(`OTT ${fmt(agg.sgOTT)}`)
  if (agg.sgAPP != null) {
    let app = `APP ${fmt(agg.sgAPP)}`
    const buckets = appBucketBreakdown(rounds, baselineSetting, handicapIndex)
    const worst = buckets.find(b => b.shots >= 5 && b.avgSG < 0) // need a real sample
    if (worst) app += ` (worst: ${worst.bucket} yds, ${fmt(worst.avgSG)}/shot)`
    parts.push(app)
  }
  if (agg.sgARG != null) parts.push(`ARG ${fmt(agg.sgARG)}`)
  if (agg.sgP != null) parts.push(`P ${fmt(agg.sgP)}`)
  else if (agg.sgT2G != null) parts.push(`T2G ${fmt(agg.sgT2G)}`)
  return `Strokes Gained (last ${agg.rounds} rounds, baseline: ${agg.baseline}): ${parts.join(' · ')}`
}

module.exports = {
  shotSG,
  holePuttSG,
  holeShotsSG,
  walkChain,
  appBucketBreakdown,
  sgPromptBlock,
  roundSG,
  aggregateSG,
  FIRST_PUTT_BUCKETS,
  BASELINE_IDS,
}
