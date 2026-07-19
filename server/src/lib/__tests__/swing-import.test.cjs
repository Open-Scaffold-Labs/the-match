// Unit tests for the archive import pipeline (lib/swingImport.js).
// Run: node server/src/lib/__tests__/swing-import.test.cjs
const assert = require('node:assert/strict')
const I = require('../swingImport.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// ── CSV parsing ─────────────────────────────────────────────────────────────
{
  const rows = I.parseCsv('a,b,c\r\n1,"x, y",3\n4,"he said ""hi""",6\n')
  ok('parses quoted commas + CRLF + escaped quotes',
     rows.length === 3 && rows[1][1] === 'x, y' && rows[2][1] === 'he said "hi"')
  ok('blank lines dropped', I.parseCsv('a\n\n\n1\n').length === 2)
}

// ── device sniffing + normalisation ─────────────────────────────────────────
const RAPSODO = [
  'Date,Club Speed,Ball Speed,Smash Factor,Launch Angle,Total Spin,Carry Distance,Total Distance',
  '2024-06-12 10:14:00,98.5,142.3,1.44,12.8,2650,242.5,268.1',
  '2024-06-12 10:16:30,99.1,143.0,1.44,13.1,2590,244.0,270.2',
  ',,,,,,,', // blank export-artifact row
].join('\n')

{
  const n = I.normalizeExport(RAPSODO)
  ok('rapsodo export sniffed', n.device === 'rapsodo')
  ok('two metric rows parsed, blank skipped', n.rows.length === 2 && n.skipped === 1)
  ok('metrics canonicalised', n.rows[0].club_speed === 98.5 && n.rows[0].spin === 2650 && n.rows[0].carry === 242.5)
  ok('timestamp parsed', n.rows[0].recorded_at instanceof Date && n.rows[0].recorded_at.getUTCFullYear() === 2024)
}

{
  const GARMIN = 'Date,Club Head Speed,Ball Speed,Smash Factor,Launch Angle,Back Spin,Carry Distance,Total Distance\n' +
                 '2025-03-01 09:00:00,101,145.2,1.44,11.9,2710,248.9,272.0\n'
  const n = I.normalizeExport(GARMIN)
  ok('garmin r10 headers sniffed (back spin alias)', n.device === 'garmin_r10' && n.rows[0].spin === 2710)
}

{
  const MEVO = 'Time,Club Speed,Ball Speed,Smash,Vertical Launch Angle,Spin Rate,Carry,Total\n' +
               '2023-08-20 17:40:00,95.0,138.0,1.45,14.0,2800,235,258\n'
  const n = I.normalizeExport(MEVO)
  ok('mevo headers sniffed (vertical launch alias)', n.device === 'mevo' && n.rows[0].launch_deg === 14.0)
}

{
  const GARBAGE = 'foo,bar\n1,2\n'
  const n = I.normalizeExport(GARBAGE)
  ok('unmappable export → device null, reported not guessed', n.device === null && n.rows.length === 0 && n.skipped === 1)
}

// ── session grouping ────────────────────────────────────────────────────────
{
  const clips = [
    { path: '/a/IMG_1.mp4', captured_at: '2024-06-12T10:00:00Z', folder: 'range' },
    { path: '/a/IMG_2.mp4', captured_at: '2024-06-12T10:20:00Z', folder: 'range' },
    { path: '/a/IMG_3.mp4', captured_at: '2024-06-13T09:00:00Z', folder: 'range' },
    { path: '/a/IMG_4.mp4', captured_at: '2024-06-13T09:10:00Z', folder: 'lesson' },
    { path: '/a/IMG_5.mp4', captured_at: 'not-a-date', folder: 'range' },
  ]
  const g = I.groupSessions(clips)
  ok('grouped by date + folder (3 sessions)', g.length === 3)
  ok('same-date same-folder merged', g[0].clips.length === 2)
  ok('undated clip excluded, not guessed', g.flatMap((x) => x.clips).length === 4)
  ok('sorted by date', g[0].date === '2024-06-12' && g[2].date === '2024-06-13')
}

// ── ball-data pairing ───────────────────────────────────────────────────────
{
  const T0 = new Date('2024-06-12T10:00:00Z').getTime()
  const session = {
    clips: [{
      captured_at: new Date(T0),
      duration_ms: 600_000,
      swings: [
        { clip_start_ms: 0,       duration_ms: 1200 }, // swing 0 @ T0
        { clip_start_ms: 300_000, duration_ms: 1250 }, // swing 1 @ T0+5min
      ],
    }],
  }
  const rows = [
    { recorded_at: new Date(T0 + 30_000),  club_speed: 98 },   // inside swing-0 window
    { recorded_at: new Date(T0 + 330_000), club_speed: 99 },   // inside swing-1 window
    { recorded_at: new Date(T0 + 120_000), club_speed: 97 },   // in session, no window
    { recorded_at: null,                   club_speed: 96 },   // no timestamp
  ]
  const p = I.pairBallData(rows, session)
  ok('in-window rows join specific swings', p.perSwing.get(0)?.length === 1 && p.perSwing.get(1)?.length === 1)
  ok('out-of-window timestamped row falls back to session level', p.sessionLevel.some((r) => r.club_speed === 97))
  ok('timestamp-less row goes session level', p.sessionLevel.some((r) => r.club_speed === 96))
  ok('nothing unpaired when session has swings', p.unpaired.length === 0)

  const noSwings = I.pairBallData([{ recorded_at: new Date(T0), club_speed: 90 }], { clips: [] })
  ok('session with no detected swings → row unpaired (honest)', noSwings.unpaired.length === 1)
}

console.log(`\nswing-import: ${pass} passed`)
