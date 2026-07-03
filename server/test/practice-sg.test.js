// SG signals in the practice engine — gating + metric conventions.
// (docs/SG-DESIGN.md research notes: putting SG says nothing below 10
// measured rounds — Brill & Wyner 2025.)

import { describe, it, expect } from 'vitest'
import {
  signalPuttingSG, signalApproachSG, primaryMetric, analyze,
  SG_PUTT_MIN_ROUNDS,
} from '../src/lib/practice.js'

const agg = (over = {}) => ({
  baseline: 'hcp-10', rounds: 20,
  roundsWithPutting: 12, roundsWithShots: 10,
  sgTotal: -2.0, sgP: -1.4, sgT2G: -0.6, sgOTT: -0.1, sgAPP: -1.2, sgARG: -0.2,
  series: [],
  ...over,
})

describe('signalPuttingSG gating', () => {
  it('emits when sample and leak are both real', () => {
    const w = signalPuttingSG(agg())
    expect(w).not.toBeNull()
    expect(w.id).toBe('sg_putting')
    expect(w.category).toBe('putting')
    expect(w.evidence.measured).toBe(true)
    expect(w.severity).toBeGreaterThan(0)
    expect(w.explanation).toContain('hcp-10')
  })
  it(`says NOTHING below ${SG_PUTT_MIN_ROUNDS} measured rounds`, () => {
    expect(signalPuttingSG(agg({ roundsWithPutting: SG_PUTT_MIN_ROUNDS - 1 }))).toBeNull()
  })
  it('does not flag a non-leak (sgP better than −0.5)', () => {
    expect(signalPuttingSG(agg({ sgP: -0.3 }))).toBeNull()
    expect(signalPuttingSG(agg({ sgP: 0.8 }))).toBeNull()
    expect(signalPuttingSG(agg({ sgP: null }))).toBeNull()
  })
  it('handles missing aggregate', () => {
    expect(signalPuttingSG(null)).toBeNull()
  })
})

describe('signalApproachSG gating', () => {
  it('gates below the shot-rounds floor', () => {
    expect(signalApproachSG(agg({ roundsWithShots: 3 }), [], 'auto', 12)).toBeNull()
  })
  it('emits without a worst bucket when buckets are thin', () => {
    const w = signalApproachSG(agg(), [], 'auto', 12)
    expect(w).not.toBeNull()
    expect(w.id).toBe('sg_approach')
    expect(w.evidence.worstBucket).toBeNull()
  })
})

describe('primaryMetric for SG weaknesses', () => {
  it('stores strokes LOST (positive, lower = better) for the closed loop', () => {
    const m = primaryMetric(signalPuttingSG(agg()))
    expect(m.value).toBeCloseTo(1.4, 5)
    expect(m.unit).toBe('strokes/round')
    const a = primaryMetric(signalApproachSG(agg(), [], 'auto', 12))
    expect(a.value).toBeCloseTo(1.2, 5)
  })
})

describe('analyze() integration', () => {
  const mkRound = (i) => ({
    total: 90, course_par: 72, course_rating: 71.0, date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    scores: Array(18).fill(5),
    hole_pars: Array(18).fill(4),
    hole_handicaps: null,
    putts: Array(18).fill(3),               // 3-putting everything = a real leak
    first_putts: Array(18).fill('10-25'),
    shots: [],
  })
  const rounds = Array.from({ length: 12 }, (_, i) => mkRound(i))

  it('surfaces measured putting among weaknesses and reports meta.sg', () => {
    const out = analyze(rounds, { handicap: 12, sgRounds: rounds, sgBaseline: 'auto' })
    expect(out.ready).toBe(true)
    expect(out.meta.sg).not.toBeNull()
    expect(out.meta.sg.roundsWithPutting).toBe(12)
    expect(out.meta.sg.puttRoundsToUnlock).toBe(0)
    expect(out.weaknesses.some(w => w.id === 'sg_putting')).toBe(true)
  })
  it('shows rounds-to-unlock when under the gate and emits no putting claim', () => {
    const few = rounds.slice(0, 4)
    const out = analyze(few, { handicap: 12, sgRounds: few, sgBaseline: 'auto' })
    expect(out.meta.sg.puttRoundsToUnlock).toBe(SG_PUTT_MIN_ROUNDS - 4)
    expect(out.weaknesses.some(w => w.id === 'sg_putting')).toBe(false)
  })
  it('fails soft when sgRounds are garbage', () => {
    const out = analyze(rounds, { handicap: 12, sgRounds: [{ bad: true }], sgBaseline: 'auto' })
    expect(out.ready).toBe(true) // plan still builds
  })
})
