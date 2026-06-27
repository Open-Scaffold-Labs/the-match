// Unit tests for the data → practice loop analysis (lib/practice.js).
// Run: node server/src/lib/__tests__/practice.test.cjs
const assert = require('node:assert/strict')
const P = require('../practice.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

const si18 = Array.from({ length: 18 }, (_, i) => i + 1)
// Build a round row from per-hole pars + per-hole over-par.
function mk(pars, overs, si = si18) {
  const scores = pars.map((p, i) => p + (overs[i] || 0))
  return {
    total: scores.reduce((s, x) => s + x, 0),
    course_par: pars.reduce((s, p) => s + p, 0),
    course_rating: 70.0, slope_rating: 125, date: '2026-06-01',
    scores, hole_pars: pars, hole_handicaps: si,
  }
}
const flat = (n) => Array.from({ length: 18 }, () => n)
const parsAll4 = flat(4)

// ── confidence / building state ─────────────────────────────────────────────
const tooFew = P.analyze([mk(parsAll4, flat(1)), mk(parsAll4, flat(1))], { handicap: 12 })
ok('under 3 rounds → not ready (building state)', tooFew.ready === false && tooFew.meta.confidence === 'insufficient')
ok('building state still returns an honest headline', /more round/i.test(tooFew.headline.detail))

const fiveLevel = Array.from({ length: 5 }, () => mk(parsAll4, flat(0)))
ok('5 rounds → usable confidence', P.analyze(fiveLevel, { handicap: 12 }).meta.confidence === 'usable')
ok('15 rounds → strong confidence',
   P.analyze(Array.from({ length: 15 }, () => mk(parsAll4, flat(0))), { handicap: 12 }).meta.confidence === 'strong')

// ── blow-up signal ──────────────────────────────────────────────────────────
// 8 of 18 holes at double bogey across 5 rounds → ~44% blow-up rate.
const blowOvers = [2,2,2,2,2,2,2,2,0,0,0,0,0,0,0,0,0,0]
const blowRounds = Array.from({ length: 5 }, () => mk(parsAll4, blowOvers))
const blowOut = P.analyze(blowRounds, { handicap: 18 })
const blowSig = blowOut.weaknesses.find(w => w.id === 'blowups')
ok('blow-up signal detected', !!blowSig && blowSig.severity >= 0.9)
ok('blow-up evidence carries the real rate', blowSig.evidence.count === 40 && blowSig.evidence.holes === 90 && blowSig.evidence.rate > 40)
ok('blow-ups map to a course-management block',
   blowOut.session.blocks.some(b => b.category === 'management'))
ok('session reserves a maintenance block', blowOut.session.blocks.some(b => b.category === 'maintenance'))

// ── par-type signal ─────────────────────────────────────────────────────────
const parsVar = [3,3,3,3,4,4,4,4,4,4,4,4,4,4,5,5,5,5] // four 3s, ten 4s, four 5s = 72
const par3Bad = parsVar.map((p) => (p === 3 ? 2 : 0)) // +2 on every par 3 only
const par3Rounds = Array.from({ length: 5 }, () => mk(parsVar, par3Bad))
const parOut = P.analyze(par3Rounds, { handicap: 8 })
const parSig = parOut.weaknesses.find(w => w.id === 'par_type')
ok('par-type signal flags par 3s as weakest', !!parSig && parSig.evidence.worstPar === 3)
ok('par-3 weakness maps to approach category', parSig.category === 'approach')
ok('low handicap gets the low-band drill target',
   parOut.focus[0].drills[0].target && /ft|gate|center|<|holed|avg/.test(parOut.focus[0].drills[0].target))

// ── back-nine fade ──────────────────────────────────────────────────────────
const fadeOvers = [0,0,0,0,0,0,0,0,0, 2,2,2,2,2,2,2,2,2] // front level, back +2 each
const fadeRounds = Array.from({ length: 4 }, () => mk(parsAll4, fadeOvers))
const fadeSig = P.analyze(fadeRounds, { handicap: 14 }).weaknesses.find(w => w.id === 'back_nine')
ok('back-nine fade detected', !!fadeSig && fadeSig.evidence.avgFade >= 1.5 && fadeSig.category === 'focus')

// ── consistency (round-to-round variance) ───────────────────────────────────
const swingy = [mk(parsAll4, flat(0)), mk(parsAll4, flat(1)), mk(parsAll4, flat(0)), mk(parsAll4, flat(1))]
const tight = Array.from({ length: 4 }, () => mk(parsAll4, flat(0)))
const swingySig = P.analyze([...swingy, mk(parsAll4, flat(2))], { handicap: 16 }).weaknesses.find(w => w.id === 'consistency')
ok('consistency signal present and bounded', !!swingySig && swingySig.severity >= 0 && swingySig.severity <= 1)

// ── well-rounded game → still always actionable (thinnest area surfaced) ─────
const balanced = P.analyze(tight.concat(mk(parsAll4, flat(0))), { handicap: 10 })
ok('a level game still surfaces ONE thinnest area (never data-with-no-action)',
   balanced.focus.length === 1 && !!balanced.session && balanced.session.blocks.length > 0)
ok('well-rounded headline is encouraging, not alarmist', /well-rounded/i.test(balanced.headline.title))
ok('well-rounded session still has drills to do', balanced.focus[0].drills.length > 0)

// ── normalize drops unusable rounds ─────────────────────────────────────────
const dirty = [
  { scores: [4,4,4], hole_pars: [4,4,4], total: 12 },             // too few holes
  { scores: [4,0,4,4,4,4,4,4,4], hole_pars: flat(4), total: 32 }, // a zero (incomplete)
  mk(parsAll4, flat(0)),                                          // good
]
ok('normalizeRounds keeps only usable rounds', P.normalizeRounds(dirty).length === 1)

// ── transparency + honesty always present ───────────────────────────────────
ok('every analysis carries the directional disclaimer', /directional/i.test(blowOut.disclaimer))
ok('session carries the closed-loop re-measure note', /re-measure|improve/i.test(blowOut.session.note))
ok('every weakness carries its evidence', blowOut.weaknesses.every(w => w.evidence && typeof w.explanation === 'string'))

// ── drills carry real how-to content ────────────────────────────────────────
const drill0 = parOut.focus[0].drills[0]
ok('drill carries setup + how-to steps + scoring',
   typeof drill0.setup === 'string' && Array.isArray(drill0.steps) && drill0.steps.length >= 2 && typeof drill0.scoring === 'string')
ok('drill carries a where + banded target', typeof drill0.where === 'string' && typeof drill0.target === 'string')
ok('DRILL_IDS is populated and includes a known drill', P.DRILL_IDS.size >= 8 && P.DRILL_IDS.has('ladder_150'))

// ── primaryMetric: single comparable number per weakness (lower=better) ──────
const pm = P.primaryMetric(parSig)
ok('primaryMetric returns value + unit + label for par-type', pm && Number.isFinite(pm.value) && /Par 3/.test(pm.label))
ok('focus carries metricNow + (null) progress with no prior logs',
   parOut.focus[0].metricNow && Number.isFinite(parOut.focus[0].metricNow.value) && parOut.focus[0].progress === null)

// ── closed loop: before→after from a prior log snapshot ─────────────────────
// Same par-3-weak player, but pretend they practised earlier when par-3 scoring
// was WORSE (a higher snapshot). progress should read as improved.
const worseSnapshot = pm.value + 0.9
const withPrior = P.analyze(par3Rounds, {
  handicap: 8,
  priorLogs: [{ weakness_id: 'par_type', metric_value: worseSnapshot, logged_at: '2026-06-01T00:00:00Z' }],
})
const prog = withPrior.focus.find(f => f.weaknessId === 'par_type').progress
ok('progress computed from prior log', !!prog && prog.before === Math.round(worseSnapshot * 10) / 10)
ok('progress flags improvement when metric fell', prog.improved === true && prog.delta > 0)
ok('progressFor returns null when no matching prior log',
   P.progressFor('blowups', { value: 5, unit: '%', label: 'x' }, [{ weakness_id: 'par_type', metric_value: 1, logged_at: '2026-06-01' }]) === null)

console.log(`\nALL ${pass} PRACTICE-LOOP ASSERTIONS PASSED`)
