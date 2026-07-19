// Unit tests for the Swing Timeline assembly + era detection (lib/swingTimeline.js).
// Run: node server/src/lib/__tests__/swing-timeline.test.cjs
const assert = require('node:assert/strict')
const TL = require('../swingTimeline.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// Build joined-rows the way routes/swing.js will: one row per swing.
let sid = 0
function session(date, ratio, durationMs = 1200, swings = 5) {
  sid++
  return Array.from({ length: swings }, () => ({
    session_id: sid, date, club_slot: '7i',
    duration_ms: durationMs + Math.round(Math.random() * 20 - 10),
    tempo_ratio: ratio + (Math.random() * 0.06 - 0.03),
  }))
}

// ── buildTimeline ───────────────────────────────────────────────────────────
{
  const rows = [
    ...session('2024-06-02', 3.0),
    ...session('2024-06-01', 3.1),
    // A session with undetectable swings (nulls) — must not crash, must count.
    { session_id: 999, date: '2024-06-03', club_slot: null, duration_ms: null, tempo_ratio: null },
  ]
  const tl = TL.buildTimeline(rows)
  ok('one point per session, sorted by date', tl.length === 3 && tl[0].date === '2024-06-01' && tl[2].date === '2024-06-03')
  ok('medians computed per session', Math.abs(tl[0].median_tempo_ratio - 3.1) < 0.1)
  ok('null-swing session → measurable 0, null medians',
     tl[2].measurable === 0 && tl[2].median_tempo_ratio === null && tl[2].confidence === 'insufficient')
  ok('carries club_slot', tl[0].club_slot === '7i')
}

// ── detectEras: two clean eras ──────────────────────────────────────────────
{
  // Six sessions at ~3.0, then six at ~2.3 — a real shift, low noise.
  const rows = []
  for (let m = 1; m <= 6; m++) rows.push(...session(`2024-0${m}-15`, 3.0))
  for (let m = 7; m <= 12; m++) rows.push(...session(`2024-${String(m).padStart(2,'0')}-15`, 2.3))
  const eras = TL.detectEras(TL.buildTimeline(rows))
  ok('two eras detected from a real shift', eras.length === 2)
  ok('first era is the 3:1 era', eras[0].median_tempo_ratio > 2.7 && eras[0].label === 'Tour-tempo era')
  ok('second era is the quickened era', eras[1].median_tempo_ratio < 2.4 && eras[1].label === 'Quickened era')
  ok('era dates span the segments', eras[0].from === '2024-01-15' && eras[1].to === '2024-12-15')
}

// ── detectEras: noise is NOT an era ─────────────────────────────────────────
{
  // Alternating 3.0 / 2.7 sessions — drift within the noise band.
  const rows = []
  for (let m = 1; m <= 10; m++) rows.push(...session(`2024-${String(m).padStart(2, '0')}-15`, m % 2 ? 3.0 : 2.72))
  const eras = TL.detectEras(TL.buildTimeline(rows))
  ok('alternating jitter → single era (no invented significance)', eras.length === 1)
}

// ── detectEras: too few sessions → single era, honest ───────────────────────
{
  const rows = [...session('2024-06-01', 3.0), ...session('2024-06-02', 2.2)]
  const eras = TL.detectEras(TL.buildTimeline(rows))
  ok('two sessions can\'t make an era boundary', eras.length === 1)

  ok('empty timeline → no eras', TL.detectEras([]).length === 0)
  const nullOnly = TL.buildTimeline([{ session_id: 1, date: '2024-01-01', club_slot: null, duration_ms: null, tempo_ratio: null }])
  ok('all-null timeline → no eras', TL.detectEras(nullOnly).length === 0)
}

// ── headline ────────────────────────────────────────────────────────────────
{
  const empty = TL.headline([], [])
  ok('empty → honest import prompt', empty.confidence === 'insufficient' && /import|film/i.test(empty.text))

  const rows = []
  for (let m = 1; m <= 6; m++) rows.push(...session(`2024-0${m}-15`, 3.0))
  for (let m = 7; m <= 12; m++) rows.push(...session(`2024-${String(m).padStart(2,'0')}-15`, 2.3))
  const tl = TL.buildTimeline(rows)
  const eras = TL.detectEras(tl)
  const h = TL.headline(tl, eras)
  ok('headline carries latest tempo + duration', /2\.3:1 tempo, \d+ms/.test(h.text))
  ok('headline names the current era', /quickened era/i.test(h.text))
  ok('12 measurable sessions → strong confidence', h.confidence === 'strong')
}

// ── narrate (Caddie voice, deterministic, sample-gated) ─────────────────────
{
  const quiet = TL.narrate([], [])
  ok('under 3 measurable sessions → silent + honest note', quiet.lines.length === 0 && quiet.confidence === 'insufficient' && /more/i.test(quiet.note))

  // Tour-band player, 6 sessions, tightening consistency.
  sid = 1000
  const rows = []
  for (let m = 1; m <= 6; m++) rows.push(...session(`2024-0${m}-15`, 3.0))
  const tl = TL.buildTimeline(rows)
  const n = TL.narrate(tl, TL.detectEras(tl))
  ok('tour-band player hears the band line', n.lines.some((l) => /Tour band/i.test(l)))
  ok('references the player\'s own numbers', n.lines.some((l) => /\d\.\d:1|3:1|3\.0:1/.test(l)))

  // Quick player hears the quick line; never hears the band line.
  sid = 2000
  const qRows = []
  for (let m = 1; m <= 6; m++) qRows.push(...session(`2024-0${m}-15`, 2.3))
  const qn = TL.narrate(TL.buildTimeline(qRows), [])
  ok('quick-tempo player hears the quick observation', qn.lines.some((l) => /runs quick/i.test(l)))
  ok('never claims the band when not in it', !qn.lines.some((l) => /Tour band/i.test(l)))

  // Era shift → the V2-honest era line (promises scoring join, doesn't invent it).
  sid = 3000
  const eRows = []
  for (let m = 1; m <= 6; m++) eRows.push(...session(`2024-0${m}-15`, 3.0))
  for (let m = 7; m <= 12; m++) eRows.push(...session(`2024-${m}-15`, 2.3))
  const etl = TL.buildTimeline(eRows)
  const en = TL.narrate(etl, TL.detectEras(etl))
  ok('era shift narrated with V2 honesty', en.lines.some((l) => /shifted eras/i.test(l) && /V2/.test(l)))
  ok('12 sessions → strong confidence', en.confidence === 'strong')
}

console.log(`\nswing-timeline: ${pass} passed`)
