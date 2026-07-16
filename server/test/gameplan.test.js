// Game Day Strategy (GamePlan) Phase 0 — unit tests for the deterministic
// layer (wiki/synthesis/gameday-strategy-build-spec-2026-07-15.md).
// Everything here is pure: no DB, no SDK. The covenant under test:
// par/yards/SI/net-strokes are OUR arithmetic; the model only narrates.

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const {
  sanitizeHoles, courseHandicap, allocateStrokes, courseHistoryDigest,
  buildFactBlocks, mergePlan, GAMEPLAN_TOOL,
} = require('../src/lib/gameplan')

const HOLES_9 = [
  { hole: 1, par: 4, yardage: 380, handicap: 5 },
  { hole: 2, par: 3, yardage: 165, handicap: 17 },
  { hole: 3, par: 5, yardage: 520, handicap: 1 },
  { hole: 4, par: 4, yardage: 410, handicap: 3 },
  { hole: 5, par: 4, yardage: 350, handicap: 13 },
  { hole: 6, par: 3, yardage: 190, handicap: 9 },
  { hole: 7, par: 5, yardage: 495, handicap: 7 },
  { hole: 8, par: 4, yardage: 400, handicap: 11 },
  { hole: 9, par: 4, yardage: 430, handicap: 15 },
]

describe('sanitizeHoles', () => {
  it('coerces numerics and keeps valid holes', () => {
    const out = sanitizeHoles(HOLES_9)
    expect(out).toHaveLength(9)
    expect(out[0]).toEqual({ hole: 1, par: 4, yards: 380, si: 5 })
  })
  it('drops holes without a par and caps at 18', () => {
    const junk = [...Array(25)].map((_, i) => ({ hole: i + 1, par: i === 0 ? null : 4 }))
    const out = sanitizeHoles(junk)
    expect(out.length).toBe(17) // 18 kept, 1 dropped for null par
    expect(out.every(h => h.par === 4)).toBe(true)
  })
  it('rejects out-of-range values instead of trusting the client', () => {
    const out = sanitizeHoles([{ hole: 1, par: 4, yardage: 9999, handicap: 44 }])
    expect(out[0].yards).toBeNull()
    expect(out[0].si).toBeNull()
  })
  it('handles non-arrays', () => {
    expect(sanitizeHoles(null)).toEqual([])
    expect(sanitizeHoles('x')).toEqual([])
  })
})

describe('courseHandicap (WHS)', () => {
  it('CH = index × slope/113 + (CR − par)', () => {
    // 15.0 × 130/113 + (71.8 − 72) = 17.26 − 0.2 → 17
    expect(courseHandicap(15.0, 130, 71.8, 72)).toBe(17)
  })
  it('null without an index; slope/rating optional', () => {
    expect(courseHandicap(null, 130, 71.8, 72)).toBeNull()
    expect(courseHandicap(10, null, null, null)).toBe(10)
  })
})

describe('allocateStrokes', () => {
  const holes = sanitizeHoles(HOLES_9)
  it('gives strokes on the lowest stroke indexes first', () => {
    const out = allocateStrokes(holes, 4) // 9-hole card, SI 1,3 get strokes... SI ≤ 4
    const strokes = Object.fromEntries(out.map(h => [h.hole, h.netStroke]))
    expect(strokes[3]).toBe(1) // SI 1
    expect(strokes[4]).toBe(1) // SI 3
    expect(strokes[2]).toBe(0) // SI 17
  })
  it('second allocation pass above 18', () => {
    const out = allocateStrokes(holes, 20) // every hole 1, SI 1-2 get 2
    expect(out.find(h => h.si === 1).netStroke).toBe(2)
    expect(out.find(h => h.si === 17).netStroke).toBe(1)
  })
  it('no CH → all zero', () => {
    expect(allocateStrokes(holes, null).every(h => h.netStroke === 0)).toBe(true)
  })
})

describe('courseHistoryDigest', () => {
  it('per-hole avg-over and blow-up rate', () => {
    const rounds = [
      { scores: [5, 3, 7], hole_pars: [4, 3, 5] },  // +1, 0, +2 (blow-up)
      { scores: [4, 4, 5], hole_pars: [4, 3, 5] },  // 0, +1, 0
    ]
    const d = courseHistoryDigest(rounds, 3)
    expect(d.roundsUsed).toBe(2)
    const h3 = d.holes.find(h => h.hole === 3)
    expect(h3.avgOver).toBe(1)
    expect(h3.blowupRate).toBe(0.5)
  })
  it('skips malformed rounds and empty holes', () => {
    const d = courseHistoryDigest([{ scores: null, hole_pars: [4] }, {}], 3)
    expect(d.roundsUsed).toBe(0)
    expect(d.holes).toEqual([])
  })
})

describe('buildFactBlocks — honest degradation', () => {
  const holes = allocateStrokes(sanitizeHoles(HOLES_9), 4)
  const base = { course: 'Test GC', holes, ch: 4, mode: 'net', history: { roundsUsed: 0, holes: [] } }
  it('names missing data instead of hiding it', () => {
    const text = buildFactBlocks({ ...base, sgBlock: null, tendencies: null, bag: null, weaknesses: [] }).join('\n')
    expect(text).toContain('Course history: none on file')
    expect(text).toContain('no club distances on file')
    expect(text).toContain('net stroke') // allocation surfaced to the model
  })
  it('carries history + bag when present', () => {
    const text = buildFactBlocks({
      ...base,
      history: { roundsUsed: 3, holes: [{ hole: 3, n: 3, avgOver: 1.33, blowupRate: 0.67 }] },
      bag: 'Driver 230y, 7i 150y', tendencies: 'typical miss: right', sgBlock: null, weaknesses: [],
    }).join('\n')
    expect(text).toContain('YOUR HISTORY ON THIS COURSE (3 rounds)')
    expect(text).toContain('blow-up rate 67%')
    expect(text).toContain('Driver 230y')
    expect(text).toContain('away from the typical miss')
  })
  it('gross-only when no handicap', () => {
    const text = buildFactBlocks({ ...base, ch: null, holes: allocateStrokes(sanitizeHoles(HOLES_9), null) }).join('\n')
    expect(text).toContain('plan gross only')
  })
  it('self-report block leads and instructs tonight-beats-stored (2026-07-15)', () => {
    const blocks = buildFactBlocks({ ...base, selfReport: 'been hooking my driver lately' })
    expect(blocks[0]).toContain("GOLFER'S SELF-REPORT")
    expect(blocks[0]).toContain('been hooking my driver lately')
    expect(blocks[0]).toContain('tonight wins')
    // absent → no block at all
    expect(buildFactBlocks({ ...base }).join('\n')).not.toContain('SELF-REPORT')
  })
})

describe('mergePlan — deterministic facts win', () => {
  const holes = allocateStrokes(sanitizeHoles(HOLES_9), 4)
  it('par/yards/SI/netStroke come from our holes, not the model', () => {
    const model = {
      summary: { headline: 'Play smart.', decisiveHoles: [3, 4, 99], leak: 'Approach right miss' },
      holes: [
        { hole: 3, par: 99, yards: 1, club: 'Driver', aim: 'left edge', avoid: 'right bunker', expect: '5–6', why: 'Your stroke hole.' },
        { hole: 99, club: 'X', aim: 'y', avoid: 'z', expect: '4' }, // unknown hole → dropped
      ],
    }
    const out = mergePlan(model, holes)
    expect(out.holes).toHaveLength(1)
    expect(out.holes[0].par).toBe(5)        // ours, not 99
    expect(out.holes[0].yards).toBe(520)    // ours, not 1
    expect(out.holes[0].netStroke).toBe(1)
    expect(out.summary.decisiveHoles).toEqual([3, 4]) // 99 filtered
  })
  it('carries the warmup prescription, sanitized and capped', () => {
    const out = mergePlan({
      summary: { headline: 'x', decisiveHoles: [], leak: '' },
      warmup: { focus: 'Tame the hook', keys: ['grip check', 'aim right edge', 'slow tempo', 'extra dropped'], inRound: 'Play the draw, aim right.' },
      holes: [{ hole: 1, club: 'Driver', aim: 'a', avoid: 'b', expect: '4' }],
    }, holes)
    expect(out.warmup.focus).toBe('Tame the hook')
    expect(out.warmup.keys).toHaveLength(3) // capped at 3
    expect(out.warmup.inRound).toBe('Play the draw, aim right.')
    // no focus → no warmup object
    const none = mergePlan({ summary: {}, warmup: { keys: ['x'] }, holes: [] }, holes)
    expect(none.warmup).toBeNull()
  })
  it('length-caps model strings', () => {
    const out = mergePlan({
      summary: { headline: 'h'.repeat(999), decisiveHoles: [], leak: '' },
      holes: [{ hole: 1, club: 'c'.repeat(999), aim: '', avoid: '', expect: '' }],
    }, holes)
    expect(out.summary.headline.length).toBe(400)
    expect(out.holes[0].club.length).toBe(60)
  })
})

describe('GAMEPLAN_TOOL schema', () => {
  it('requires summary + holes with the card fields', () => {
    expect(GAMEPLAN_TOOL.input_schema.required).toEqual(['summary', 'holes'])
    expect(GAMEPLAN_TOOL.input_schema.properties.holes.items.required)
      .toEqual(['hole', 'club', 'aim', 'avoid', 'expect'])
  })
})
