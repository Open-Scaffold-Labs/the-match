// Data → practice loop (Leapfrog 3.5).
//
// Turns a player's completed rounds into (a) transparent, score-only weakness
// SIGNALS and (b) a structured, benchmarked practice session that targets the
// biggest weaknesses — then exposes each signal's raw number so a later run can
// re-measure and CLOSE THE LOOP (the differentiator no incumbent owns).
//
// Honesty contract (from the competitive research): with per-hole scores + pars
// + stroke index we can credibly produce DIRECTIONAL tendency signals — NOT
// true strokes-gained (that needs shot-level start/end positions). Every signal
// carries the exact evidence behind it and we label the whole thing directional.
// Confidence rises with sample size (≈5 rounds = usable, 8+ = solid, 15+ = strong).
//
// Pure functions only — no DB, no IO. The route (routes/practice.js) feeds it
// rows and serialises the result. Fully unit-tested (lib/__tests__/practice.test.cjs).

// ── parsing helpers ─────────────────────────────────────────────────────────
const asArr = (v) => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
  return null
}
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const round1 = (x) => Math.round(x * 10) / 10

// Normalise raw DB rows into analysable rounds. A round is usable when it has
// per-hole scores (all > 0) AND per-hole pars of equal length. Stroke index is
// optional (its signal is skipped when absent). 9- and 18-hole rounds both count.
function normalizeRounds(rawRounds) {
  const out = []
  for (const r of (rawRounds || [])) {
    const scores = asArr(r.scores)
    const pars   = asArr(r.hole_pars)
    if (!scores || !pars) continue
    if (scores.length < 9 || pars.length < scores.length) continue
    if (!scores.every(s => Number.isFinite(Number(s)) && Number(s) > 0)) continue
    const si = asArr(r.hole_handicaps)
    const holes = scores.map((s, i) => {
      const score = Number(s)
      const par = Number(pars[i])
      const sidx = (si && Number.isFinite(Number(si[i]))) ? Number(si[i]) : null
      return Number.isFinite(par)
        ? { i, score, par, over: score - par, si: sidx }
        : null
    }).filter(Boolean)
    if (holes.length < 9) continue
    out.push({ holes, holeCount: scores.length, date: r.date })
  }
  return out
}

// Handicap band for benchmark targets.
function band(handicap) {
  const h = Number(handicap)
  if (!Number.isFinite(h)) return 'mid'
  if (h <= 9) return 'low'
  if (h <= 19) return 'mid'
  return 'high'
}

// ── weakness signals (all score-only, all carry their evidence) ─────────────
// Each returns { id, label, severity:0..1, evidence:{}, explanation, category }
// or null when its required data isn't present across the sample.

function allHoles(rounds) { return rounds.flatMap(r => r.holes) }
function avg(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null }

// 1. Scoring by par type — which par type bleeds the most strokes vs your own
//    overall average. Par-3 weak → tee/approach distance control; par-5 weak →
//    long game + wedges; par-4 weak → ball-striking.
function signalParType(rounds) {
  const holes = allHoles(rounds)
  if (holes.length < 18) return null
  const overall = avg(holes.map(h => h.over))
  const byPar = {}
  for (const p of [3, 4, 5]) {
    const g = holes.filter(h => h.par === p)
    if (g.length >= 3) byPar[p] = { over: round1(avg(g.map(h => h.over))), holes: g.length }
  }
  const present = Object.keys(byPar)
  if (present.length < 2) return null
  let worstPar = null, worstOver = -Infinity
  for (const p of present) if (byPar[p].over > worstOver) { worstOver = byPar[p].over; worstPar = Number(p) }
  const label = { 3: 'Par 3s', 4: 'Par 4s', 5: 'Par 5s' }[worstPar]
  const severity = clamp01((worstOver - overall) / 1.2)
  return {
    id: 'par_type',
    label: `${label} are your weakest`,
    severity,
    evidence: { overall: round1(overall), byPar, worstPar, worstOver },
    explanation: `You average ${worstOver > 0 ? '+' : ''}${worstOver} on ${label.toLowerCase()} vs ${round1(overall) > 0 ? '+' : ''}${round1(overall)} across all holes.`,
    category: worstPar === 3 ? 'approach' : worstPar === 5 ? 'wedge' : 'ballstriking',
  }
}

// 2. Blow-up-hole rate — share of holes at double bogey or worse. High rate with
//    otherwise-ok scoring = course management / recovery, NOT a swing fault.
function signalBlowups(rounds) {
  const holes = allHoles(rounds)
  if (holes.length < 18) return null
  const blow = holes.filter(h => h.over >= 2).length
  const rate = blow / holes.length
  return {
    id: 'blowups',
    label: 'Blow-up holes are costing you',
    severity: clamp01(rate / 0.20), // 20%+ of holes at double+ = max severity
    evidence: { rate: round1(rate * 100), count: blow, holes: holes.length },
    explanation: `${Math.round(rate * 100)}% of your holes are double bogey or worse — recovery and smart-miss decisions are the fastest strokes back.`,
    category: 'management',
  }
}

// 3. Tough-hole performance — over-par on the hardest holes (Stroke Index 1–6)
//    vs your overall average. Big gap → you lose strokes on length/difficulty.
function signalToughHoles(rounds) {
  const holes = allHoles(rounds).filter(h => h.si != null)
  if (holes.length < 18) return null
  const hard = holes.filter(h => h.si >= 1 && h.si <= 6)
  const easy = holes.filter(h => h.si >= 13 && h.si <= 18)
  if (hard.length < 3 || easy.length < 3) return null
  const overall = avg(holes.map(h => h.over))
  const hardOver = avg(hard.map(h => h.over))
  const easyOver = avg(easy.map(h => h.over))
  const severity = clamp01((hardOver - overall) / 1.0)
  return {
    id: 'tough_holes',
    label: 'The hardest holes hurt most',
    severity,
    evidence: { hardOver: round1(hardOver), easyOver: round1(easyOver), overall: round1(overall) },
    explanation: `On the 6 hardest holes you average +${round1(hardOver)} — long approaches and trouble holes are where your card slips.`,
    category: 'approach',
  }
}

// 4. Front-9 vs back-9 fade — systematic back-nine inflation (18-hole rounds
//    only) flags fitness/focus/routine, not mechanics.
function signalBackNine(rounds) {
  const eighteens = rounds.filter(r => r.holes.length >= 18)
  if (eighteens.length < 3) return null
  const fades = eighteens.map(r => {
    const front = r.holes.slice(0, 9), back = r.holes.slice(9, 18)
    return (avg(back.map(h => h.over)) - avg(front.map(h => h.over)))
  })
  const avgFade = avg(fades)
  return {
    id: 'back_nine',
    label: 'Your back nine fades',
    severity: clamp01(avgFade / 2.0), // +2 strokes/9 of fade = max severity
    evidence: { avgFade: round1(avgFade), rounds: eighteens.length },
    explanation: `Your back nine averages ${round1(avgFade) > 0 ? '+' : ''}${round1(avgFade)} strokes vs your front — a focus/conditioning pattern, not a swing one.`,
    category: 'focus',
  }
}

// 5. Round-to-round consistency — variance in score-to-par across rounds. A
//    "great rounds then disaster" spread = a management/mental story; tight =
//    a strength. (Distinct from per-hole blow-ups.)
function signalConsistency(rounds) {
  if (rounds.length < 4) return null
  const perRound = rounds.map(r => avg(r.holes.map(h => h.over)) * r.holes.length)
  const m = avg(perRound)
  const variance = avg(perRound.map(x => (x - m) ** 2))
  const stdev = Math.sqrt(variance)
  const parOrBetter = allHoles(rounds).filter(h => h.over <= 0).length / allHoles(rounds).length
  return {
    id: 'consistency',
    label: 'Your scoring swings round to round',
    severity: clamp01((stdev - 2) / 6), // stdev ~2 = tight; ~8 = very swingy
    evidence: { stdev: round1(stdev), parOrBetterPct: Math.round(parOrBetter * 100), rounds: rounds.length },
    explanation: `Your round-to-round scoring swings by ±${round1(stdev)} strokes — steadier course management compresses the bad days.`,
    category: 'management',
  }
}

const SIGNALS = [signalParType, signalBlowups, signalToughHoles, signalBackNine, signalConsistency]

// ── curated drill library (benchmarked skills-games, not block reps) ────────
// Each drill maps to a weakness category and carries a handicap-banded target so
// the player knows when they've "passed" (kills the practice-boredom failure mode).
const DRILLS = {
  approach: [
    { id: 'ladder_150', title: 'Distance ladder — 130/150/170 yds', durationMin: 20,
      why: 'Dialing approach distances is where amateurs gain the most strokes.',
      target: { low: '6/9 inside 25 ft', mid: '5/9 inside 35 ft', high: '4/9 on the green' } },
    { id: 'long_iron_gate', title: 'Long-iron start-line gate', durationMin: 15,
      why: 'Cleaner long-iron contact tames the hardest holes.',
      target: { low: '7/10 through the gate', mid: '6/10 through the gate', high: '5/10 airborne & online' } },
  ],
  wedge: [
    { id: 'wedge_clock', title: 'Wedge clock — 40/70/100 yds', durationMin: 20,
      why: 'Par-5 scoring lives in the 40–110 yd wedge zone.',
      target: { low: '6/9 inside 12 ft', mid: '5/9 inside 20 ft', high: '4/9 inside 30 ft' } },
    { id: 'scoring_zone', title: 'Scoring-zone proximity (sub-110)', durationMin: 15,
      why: 'Tighter wedges turn par-5s into birdie chances.',
      target: { low: 'avg < 15 ft', mid: 'avg < 24 ft', high: 'avg < 35 ft' } },
  ],
  ballstriking: [
    { id: 'center_face', title: 'Center-face strike (foot-spray)', durationMin: 15,
      why: 'Center contact is the root of par-4 ball-striking.',
      target: { low: '8/10 center', mid: '6/10 center', high: '5/10 center' } },
    { id: 'tempo_3to1', title: '3:1 tempo iron block', durationMin: 15,
      why: 'A repeatable tempo steadies full swings under pressure.',
      target: { low: '9/10 solid', mid: '7/10 solid', high: '6/10 solid' } },
  ],
  management: [
    { id: 'bailout_punch', title: 'Punch-out & recovery routine', durationMin: 15,
      why: 'A disciplined recovery turns a double into a bogey.',
      target: { low: 'cap worst hole at +1', mid: 'cap worst hole at +2', high: 'no triples' } },
    { id: 'center_green', title: 'Play-to-center decision reps', durationMin: 10,
      why: 'Aiming center, not at flags, slashes blow-up holes.',
      target: { low: '9/10 center commit', mid: '8/10 center commit', high: '7/10 center commit' } },
  ],
  shortgame: [
    { id: 'up_and_down', title: 'Up-and-down challenge (9 balls)', durationMin: 20,
      why: 'Getting up-and-down erases approach misses.',
      target: { low: '5/9 up-and-down', mid: '4/9 up-and-down', high: '3/9 up-and-down' } },
  ],
  putting: [
    { id: 'lag_ladder', title: 'Lag-putt speed ladder (30→40 ft)', durationMin: 15,
      why: 'Speed control kills three-putts on the easy holes.',
      target: { low: '8/10 inside 3 ft', mid: '7/10 inside 3 ft', high: '6/10 inside 3 ft' } },
    { id: 'gate_5ft', title: '5-foot gate drill', durationMin: 10,
      why: 'Short putts holed protect every good hole.',
      target: { low: '9/10 holed', mid: '8/10 holed', high: '7/10 holed' } },
  ],
  focus: [
    { id: 'routine_reset', title: 'Pre-shot routine + breath reset', durationMin: 10,
      why: 'A consistent routine resists back-nine focus drop.',
      target: { low: 'routine on 10/10', mid: 'routine on 9/10', high: 'routine on 8/10' } },
    { id: 'finish_strong', title: 'Back-nine simulation (last 9 first)', durationMin: 15,
      why: 'Practising tired-focus holes trains the fade away.',
      target: { low: 'match front-9 avg', mid: 'within +1 of front', high: 'within +2 of front' } },
  ],
  maintenance: [
    { id: 'maintain', title: 'Maintenance — keep your strength sharp', durationMin: 10,
      why: 'A small slice on what you do well stops it slipping.',
      target: { low: 'light reps', mid: 'light reps', high: 'light reps' } },
  ],
}

// Map a weakness category to its drill block, applying the player's banded target.
function drillsFor(category, hcpBand) {
  const list = DRILLS[category] || DRILLS.management
  return list.map(d => ({
    id: d.id, title: d.title, durationMin: d.durationMin, why: d.why,
    target: d.target[hcpBand],
  }))
}

const CATEGORY_LABEL = {
  approach: 'Approach & long irons', wedge: 'Wedge / scoring zone',
  ballstriking: 'Ball-striking', management: 'Course management',
  shortgame: 'Short game', putting: 'Putting', focus: 'Focus & routine',
  maintenance: 'Maintenance',
}

// ── public API ───────────────────────────────────────────────────────────────
// analyze(rawRounds, { handicap, minutes }) → full practice payload.
function analyze(rawRounds, opts = {}) {
  const rounds = normalizeRounds(rawRounds)
  const minutes = Number.isFinite(Number(opts.minutes)) ? Math.max(20, Math.min(120, Number(opts.minutes))) : 60
  const hcpBand = band(opts.handicap)
  const holesAnalyzed = allHoles(rounds).length

  // Confidence by sample size (the research thresholds).
  let confidence = 'insufficient'
  if (rounds.length >= 15) confidence = 'strong'
  else if (rounds.length >= 8) confidence = 'solid'
  else if (rounds.length >= 5) confidence = 'usable'
  else if (rounds.length >= 3) confidence = 'building'

  const meta = {
    roundsAnalyzed: rounds.length, holesAnalyzed, confidence,
    handicapBand: hcpBand, generatedAt: new Date().toISOString(),
  }

  // Below 3 rounds we don't infer — return the honest "building your profile" state.
  if (rounds.length < 3) {
    return {
      meta,
      ready: false,
      headline: { title: 'Building your game profile', detail: `Log ${3 - rounds.length} more round${3 - rounds.length === 1 ? '' : 's'} and we'll pinpoint where you're losing strokes.` },
      weaknesses: [], focus: [], session: null,
      disclaimer: DISCLAIMER,
    }
  }

  // Compute every signal, drop nulls, rank by severity.
  const weaknesses = SIGNALS.map(fn => fn(rounds)).filter(Boolean)
    .sort((a, b) => b.severity - a.severity)

  // Focus = signals that are a REAL signal (severity ≥ 0.33), top 3.
  const focusSignals = weaknesses.filter(w => w.severity >= 0.33).slice(0, 3)

  // Headline = the single biggest insight, glanceable (avoids post-round overload).
  const headline = focusSignals.length
    ? { title: focusSignals[0].label, detail: focusSignals[0].explanation }
    : { title: 'Your game is well-rounded', detail: 'No single area is bleeding strokes — keep your strengths sharp and chase consistency.' }

  // Build the session: allocate minutes across focus areas by severity weight,
  // reserve ~15% for maintenance. Each block carries its drills + the metric that
  // flagged it (so a later run can re-measure and show before→after).
  const focus = []
  const session = { totalMinutes: minutes, blocks: [], note: CLOSED_LOOP_NOTE }
  if (focusSignals.length) {
    const maint = Math.round(minutes * 0.15)
    const workMinutes = minutes - maint
    const sevSum = focusSignals.reduce((s, w) => s + w.severity, 0) || 1
    for (const w of focusSignals) {
      const alloc = Math.max(10, Math.round(workMinutes * (w.severity / sevSum)))
      const drills = drillsFor(w.category, hcpBand)
      focus.push({
        weaknessId: w.id, label: w.label, category: w.category,
        categoryLabel: CATEGORY_LABEL[w.category] || w.category,
        allocationMinutes: alloc, severity: round1(w.severity),
        // closed-loop anchor: the exact metric + value behind the flag
        metric: w.evidence, drills,
      })
      session.blocks.push({
        category: w.category, label: CATEGORY_LABEL[w.category] || w.category,
        minutes: alloc, drills,
      })
    }
    session.blocks.push({
      category: 'maintenance', label: CATEGORY_LABEL.maintenance,
      minutes: maint, drills: drillsFor('maintenance', hcpBand),
    })
  }

  return { meta, ready: true, headline, weaknesses, focus, session, disclaimer: DISCLAIMER }
}

const DISCLAIMER =
  'Directional analysis from your scores, pars and stroke index — it points at likely causes, not measured strokes-gained. ' +
  'Confidence grows as you log more rounds; add shot tracking to sharpen it.'

const CLOSED_LOOP_NOTE =
  "Keep logging rounds — after a few more we'll re-measure these exact numbers and show whether your focus areas improved."

module.exports = {
  normalizeRounds, band, analyze,
  // exported for unit tests
  signalParType, signalBlowups, signalToughHoles, signalBackNine, signalConsistency,
  DRILLS, drillsFor,
}
