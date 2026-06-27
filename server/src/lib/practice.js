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
    area: `Par-${worstPar} play`,
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
    area: 'Blow-up holes',
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
    area: 'The hardest holes',
    severity,
    evidence: { hardOver: round1(hardOver), easyOver: round1(easyOver), overall: round1(overall) },
    explanation: `On the 6 hardest holes you average +${round1(hardOver)} — length off the tee and long approaches are where your card slips.`,
    category: 'longgame',
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
    area: 'Front-to-back balance',
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
    area: 'Round-to-round consistency',
    severity: clamp01((stdev - 2) / 6), // stdev ~2 = tight; ~8 = very swingy
    evidence: { stdev: round1(stdev), parOrBetterPct: Math.round(parOrBetter * 100), rounds: rounds.length },
    explanation: `Your round-to-round scoring swings by ±${round1(stdev)} strokes — a steady pre-shot routine and pressure reps compress the bad days.`,
    category: 'pressure',
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
      where: 'Driving range with yardage markers',
      setup: 'Pick a target green or flag at ~130, then 150, then 170 yards. 3 balls to each, 9 total.',
      steps: [
        'Hit 3 balls to the 130 target — full routine on each, like it counts.',
        'Move up to 150, then 170. Don’t rake-and-rake; reset between shots.',
        'Note how close each finishes to the target (paces or a marker).',
        'Count how many of the 9 finish inside your target distance.',
      ],
      scoring: 'Count balls that finish inside the target proximity for your level.',
      target: { low: '6/9 inside 25 ft', mid: '5/9 inside 35 ft', high: '4/9 on the green' } },
    { id: 'long_iron_gate', title: 'Long-iron start-line gate', durationMin: 15,
      why: 'Cleaner long-iron contact tames the hardest holes.',
      where: 'Driving range',
      setup: 'Stick two tees ~3 ft ahead of the ball, a clubhead-width apart, on your target line.',
      steps: [
        'Hit your longest comfortable iron through the gate at a far target.',
        'A ball that starts through the gate = on your start line.',
        'Reset and repeat 10 balls; track gate hits AND solid contact.',
      ],
      scoring: 'Count balls that start through the gate (airborne & on line).',
      target: { low: '7/10 through the gate', mid: '6/10 through the gate', high: '5/10 airborne & online' } },
  ],
  wedge: [
    { id: 'wedge_clock', title: 'Wedge clock — 40/70/100 yds', durationMin: 20,
      why: 'Par-5 scoring lives in the 40–110 yd wedge zone.',
      where: 'Range or short-game area with distance markers',
      setup: '3 balls each to 40, 70 and 100 yard targets — 9 total. Same wedge or step through your wedges.',
      steps: [
        'Match a swing length to each distance (e.g. 40 = half, 70 = 3/4, 100 = full).',
        'Hit 3 to each target with a full pre-shot routine.',
        'Judge finish distance from the flag, not just direction.',
        'Tally how many finish inside the proximity target.',
      ],
      scoring: 'Count balls inside the proximity target for your level.',
      target: { low: '6/9 inside 12 ft', mid: '5/9 inside 20 ft', high: '4/9 inside 30 ft' } },
    { id: 'scoring_zone', title: 'Scoring-zone proximity (sub-110)', durationMin: 15,
      why: 'Tighter wedges turn par-5s into birdie chances.',
      where: 'Short-game area or range',
      setup: 'Pick one flag inside 110 yds. 10 balls, one target.',
      steps: [
        'Full routine on every ball — treat each like a real approach.',
        'Pace off (or eyeball) each finish distance from the flag.',
        'Average the 10 finish distances.',
      ],
      scoring: 'Average proximity across 10 balls.',
      target: { low: 'avg < 15 ft', mid: 'avg < 24 ft', high: 'avg < 35 ft' } },
  ],
  ballstriking: [
    { id: 'center_face', title: 'Center-face strike (foot-spray)', durationMin: 15,
      why: 'Center contact is the root of par-4 ball-striking.',
      where: 'Range',
      setup: 'Lightly mist your iron face with foot-spray or dry-shampoo so strikes leave a mark.',
      steps: [
        'Hit a ball, read the strike mark on the face, wipe, repeat.',
        'Aim for center — not toe, not heel, not thin.',
        '10 balls; count the ones that mark dead center.',
      ],
      scoring: 'Count center strikes out of 10.',
      target: { low: '8/10 center', mid: '6/10 center', high: '5/10 center' } },
    { id: 'tempo_3to1', title: '3:1 tempo iron block', durationMin: 15,
      why: 'A repeatable tempo steadies full swings under pressure.',
      where: 'Range',
      setup: 'Count a 3:1 ratio — backswing “one-two-three”, downswing “one”.',
      steps: [
        'Swing to that count on every ball; no rush from the top.',
        'Prioritise a balanced, held finish over distance.',
        '10 balls; count solid, balanced strikes.',
      ],
      scoring: 'Count solid + balanced finishes out of 10.',
      target: { low: '9/10 solid', mid: '7/10 solid', high: '6/10 solid' } },
  ],
  management: [
    { id: 'bailout_punch', title: 'Punch-out & recovery routine', durationMin: 15,
      why: 'A disciplined recovery turns a double into a bogey.',
      where: 'Range (or a quiet hole)',
      setup: 'Imagine you’re behind a tree / in trouble. Pick the SAFE gap, not the hero shot.',
      steps: [
        'Choose a low punch club and a wide bail-out target back in play.',
        'Commit fully to the safe shot — no half-hearted hero swing.',
        'Run 8–10 “escape” reps to different safe targets.',
      ],
      scoring: 'Count escapes that finish safely back in play, worst-hole capped.',
      target: { low: 'cap worst hole at +1', mid: 'cap worst hole at +2', high: 'no triples' } },
    { id: 'center_green', title: 'Play-to-center decision reps', durationMin: 10,
      why: 'Aiming center, not at flags, slashes blow-up holes.',
      where: 'Range',
      setup: 'For every approach, pick the FAT center of the green, never the tucked pin.',
      steps: [
        'State your center target out loud before each ball.',
        'Hit to center; a tucked-pin miss that finds the green still “passes”.',
        '10 balls; count committed center swings.',
      ],
      scoring: 'Count balls you committed to center (and found the green).',
      target: { low: '9/10 center commit', mid: '8/10 center commit', high: '7/10 center commit' } },
  ],
  shortgame: [
    { id: 'up_and_down', title: 'Up-and-down challenge (9 balls)', durationMin: 20,
      why: 'Getting up-and-down erases approach misses.',
      where: 'Chipping green',
      setup: 'Drop 9 balls in different lies around one green — short, long, rough, bunker if you can.',
      steps: [
        'Play each ball out: chip/pitch on, then putt out.',
        'Count it “up-and-down” only if you hole within 2 shots.',
        'Move to a new lie each ball — never repeat the same chip.',
      ],
      scoring: 'Count up-and-downs out of 9.',
      target: { low: '5/9 up-and-down', mid: '4/9 up-and-down', high: '3/9 up-and-down' } },
  ],
  putting: [
    { id: 'lag_ladder', title: 'Lag-putt speed ladder (30→40 ft)', durationMin: 15,
      why: 'Speed control kills three-putts on the easy holes.',
      where: 'Putting green',
      setup: 'Find a 30–40 ft putt. Lay a tee 3 ft past the hole as your “safe zone”.',
      steps: [
        'Roll 10 lag putts focused on SPEED, not the line.',
        'A putt that stops inside a 3 ft circle (hole-high to 3 ft past) passes.',
        'Reset to the same start each time.',
      ],
      scoring: 'Count putts finishing inside 3 ft, out of 10.',
      target: { low: '8/10 inside 3 ft', mid: '7/10 inside 3 ft', high: '6/10 inside 3 ft' } },
    { id: 'gate_5ft', title: '5-foot gate drill', durationMin: 10,
      why: 'Short putts holed protect every good hole.',
      where: 'Putting green',
      setup: 'Two tees just wider than the ball, ~6 inches in front of a 5 ft putt.',
      steps: [
        'Roll the ball through the gate into the hole.',
        'Through the gate AND holed = a make.',
        '10 putts; count makes.',
      ],
      scoring: 'Count makes out of 10.',
      target: { low: '9/10 holed', mid: '8/10 holed', high: '7/10 holed' } },
  ],
  focus: [
    { id: 'routine_reset', title: 'Pre-shot routine + breath reset', durationMin: 10,
      why: 'A consistent routine resists back-nine focus drop.',
      where: 'Range',
      setup: 'Define a fixed routine: 1 look, 1 breath, 1 rehearsal, go. Same every time.',
      steps: [
        'Run your exact routine before all 10 balls — no skipping steps when tired.',
        'One slow exhale right before you start back.',
        'Count balls where you nailed the full routine.',
      ],
      scoring: 'Count full, unhurried routines out of 10.',
      target: { low: 'routine on 10/10', mid: 'routine on 9/10', high: 'routine on 8/10' } },
    { id: 'finish_strong', title: 'Back-nine simulation (last 9 first)', durationMin: 15,
      why: 'Practising tired-focus holes trains the fade away.',
      where: 'Range or a quick 9',
      setup: 'Warm up minimally, then play your “back nine” shots first — when you’re least sharp.',
      steps: [
        'Simulate the closing holes you usually fade on.',
        'Hold your standards: full routine, center targets.',
        'Score it vs how you’d normally play your front nine.',
      ],
      scoring: 'Compare simulated back-9 quality to your front-9 baseline.',
      target: { low: 'match front-9 avg', mid: 'within +1 of front', high: 'within +2 of front' } },
  ],
  longgame: [
    { id: 'driver_fairway', title: 'Fairway finder (15-yd corridor)', durationMin: 20,
      why: 'Finding the short grass on long holes is the cheapest way to tame them.',
      where: 'Driving range',
      setup: 'Pick two distant markers ~15 yds apart as an imaginary fairway. 10 drives.',
      steps: [
        'Full routine on each drive; pick the corridor, not just “far”.',
        'A drive that finishes between the two markers = a fairway.',
        'Count fairways out of 10 — distance is secondary to finding the corridor.',
      ],
      scoring: 'Count drives that finish in the corridor, out of 10.',
      target: { low: '7/10 fairways', mid: '6/10 fairways', high: '5/10 fairways' } },
    { id: 'hybrid_stinger', title: 'Long-iron / hybrid carry control', durationMin: 15,
      why: 'A reliable long club turns a hard par into a putt at par.',
      where: 'Driving range',
      setup: 'One far target. 10 balls with your longest iron or hybrid.',
      steps: [
        'Prioritise solid, airborne contact over crushing it.',
        'Note carry consistency — tight grouping beats one big one.',
        'Count solid strikes that reach your target zone.',
      ],
      scoring: 'Count solid strikes reaching the target zone, out of 10.',
      target: { low: '7/10 solid', mid: '6/10 solid', high: '5/10 airborne' } },
  ],
  pressure: [
    { id: 'one_ball_game', title: 'One-ball pressure game (9 shots)', durationMin: 20,
      why: 'Reps that count train the steadiness that compresses your bad days.',
      where: 'Range or course',
      setup: '9 different shots (driver, irons, wedges, a putt). ONE ball — every shot counts.',
      steps: [
        'Pick a target + a pass/fail for each of the 9 shots before you hit.',
        'Full routine, full consequence — no mulligans, no rakes.',
        'Score 1 point per shot that meets its goal; total out of 9.',
      ],
      scoring: 'Total points out of 9 (each shot has its own pass/fail).',
      target: { low: '6/9', mid: '5/9', high: '4/9' } },
    { id: 'warmup_routine', title: 'Repeatable warm-up + first-tee routine', durationMin: 15,
      why: 'A fixed warm-up and first-tee routine removes the “cold start” bad round.',
      where: 'Range before a round',
      setup: 'Build a fixed 9-ball warm-up ladder: wedge → mid-iron → driver → one “first-tee” shot.',
      steps: [
        'Run the same ladder, same order, every time.',
        'Finish with your exact first-tee routine on one committed shot.',
        'Rate how ready you felt 1–10; aim to repeat it identically next time.',
      ],
      scoring: 'Self-rate readiness; the goal is a repeatable routine, not a score.',
      target: { low: 'same routine every time', mid: 'same routine every time', high: 'build the routine' } },
  ],
  maintenance: [
    { id: 'maintain', title: 'Maintenance — keep your strength sharp', durationMin: 10,
      why: 'A small slice on what you do well stops it slipping.',
      where: 'Wherever your strength lives',
      setup: 'Spend a few minutes on the part of your game that’s already good.',
      steps: [
        'Pick your strongest area (your best stat).',
        'Do a light, enjoyable set of reps — keep the groove.',
      ],
      scoring: 'Quick check-in — did it still feel sharp?',
      target: { low: 'light reps', mid: 'light reps', high: 'light reps' } },
  ],
}

// Set of valid drill ids (for validating POST /api/practice/log).
const DRILL_IDS = new Set(Object.values(DRILLS).flat().map(d => d.id))

// Map a weakness category to its drill block, applying the player's banded target
// and passing the full how-to content through to the client.
function drillsFor(category, hcpBand) {
  const list = DRILLS[category] || DRILLS.management
  return list.map(d => ({
    id: d.id, title: d.title, durationMin: d.durationMin, why: d.why,
    where: d.where, setup: d.setup, steps: d.steps, scoring: d.scoring,
    target: d.target[hcpBand],
  }))
}

const CATEGORY_LABEL = {
  approach: 'Approach & long irons', wedge: 'Wedge / scoring zone',
  ballstriking: 'Ball-striking', management: 'Course management',
  shortgame: 'Short game', putting: 'Putting', focus: 'Focus & routine',
  longgame: 'Long game (driver & long irons)', pressure: 'Pressure & consistency',
  maintenance: 'Maintenance',
}

// The single comparable number behind each weakness — lower is always better.
// Used to snapshot a weakness when the player practises it, then re-measure
// later (the closed loop). Returns { value, unit, label } or null.
function primaryMetric(w) {
  if (!w || !w.evidence) return null
  switch (w.id) {
    case 'par_type': {
      const p = w.evidence.worstPar
      const lbl = p === 3 ? 'Par 3 scoring' : p === 5 ? 'Par 5 scoring' : 'Par 4 scoring'
      return { value: w.evidence.worstOver, unit: 'over par', label: lbl }
    }
    case 'blowups':     return { value: w.evidence.rate,    unit: '%',       label: 'Blow-up rate' }
    case 'tough_holes': return { value: w.evidence.hardOver, unit: 'over par', label: 'Hard-hole scoring' }
    case 'back_nine':   return { value: w.evidence.avgFade,  unit: 'strokes', label: 'Back-nine fade' }
    case 'consistency': return { value: w.evidence.stdev,    unit: 'strokes', label: 'Scoring spread' }
    default: return null
  }
}

// Closed-loop progress for a focus area: compare the metric snapshot from the
// player's most recent PRIOR practice of this weakness against where it sits now.
// priorLogs: [{ weakness_id, metric_value, logged_at }]. Lower = better.
function progressFor(weaknessId, metricNow, priorLogs) {
  if (!metricNow || !Array.isArray(priorLogs)) return null
  const prior = priorLogs
    .filter(l => l.weakness_id === weaknessId && l.metric_value != null && Number.isFinite(Number(l.metric_value)))
    .sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at))[0]
  if (!prior) return null
  const before = Number(prior.metric_value)
  const after = metricNow.value
  return {
    before: round1(before), after: round1(after),
    delta: round1(before - after), // positive = improved (metric fell)
    improved: after < before, unchanged: after === before,
    since: prior.logged_at, unit: metricNow.unit, label: metricNow.label,
  }
}

// ── public API ───────────────────────────────────────────────────────────────
// analyze(rawRounds, { handicap, minutes, priorLogs }) → full practice payload.
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

  // Focus = signals that are a REAL signal (severity ≥ 0.33), top 3. If NOTHING
  // clears the bar the player is well-rounded — but we still surface their single
  // thinnest area so the screen is ALWAYS actionable (never "data with no
  // action"). Framed as "sharpen", not "fix".
  let focusSignals = weaknesses.filter(w => w.severity >= 0.33).slice(0, 3)
  const wellRounded = focusSignals.length === 0
  if (wellRounded && weaknesses.length) focusSignals = weaknesses.slice(0, 1)

  // Headline = the single biggest insight, glanceable (avoids post-round overload).
  const headline = wellRounded
    ? { title: 'Your game is well-rounded', detail: 'No single area is bleeding strokes — here’s the thinnest edge to sharpen and keep improving.' }
    : (focusSignals.length
        ? { title: focusSignals[0].label, detail: focusSignals[0].explanation }
        : { title: 'Building your game profile', detail: 'Keep logging rounds and we’ll pinpoint your focus areas.' })

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
      const metricNow = primaryMetric(w)
      focus.push({
        weaknessId: w.id, label: w.label, category: w.category,
        categoryLabel: CATEGORY_LABEL[w.category] || w.category,
        allocationMinutes: alloc, severity: round1(w.severity),
        // closed-loop anchors: the exact evidence + the single comparable metric,
        // plus before→after progress vs the last time this was practised.
        metric: w.evidence, metricNow, drills,
        progress: progressFor(w.id, metricNow, opts.priorLogs),
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
  normalizeRounds, band, analyze, primaryMetric, progressFor,
  DRILL_IDS,
  // exported for unit tests
  signalParType, signalBlowups, signalToughHoles, signalBackNine, signalConsistency,
  DRILLS, drillsFor,
}
