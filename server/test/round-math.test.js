// roundMath — the shared holes-played-aware math library.
// Spec: wiki/synthesis/partial-rounds-stats-build-spec-2026-07-16.md §2/§4/§7.
import { describe, it, expect } from 'vitest'
import {
  playedCount, isFullRound, isQualifying, parPlayed, toParThrough, par18, equiv18,
} from '../src/lib/roundMath'

const PARS18 = [4,4,3,5,4,4,3,5,4, 4,4,3,5,4,4,3,5,4] // par 72
const full18 = (over = 10) => {
  // all 4s + spread the overage — simplest: bogey the first `over` holes
  const scores = PARS18.map((p, i) => (i < over ? p + 1 : p))
  return { total: scores.reduce((s, x) => s + x, 0), course_par: 72, scores, hole_pars: PARS18 }
}

describe('playedCount', () => {
  it('counts only scores > 0', () => {
    expect(playedCount([4, 0, 5, null, 3])).toBe(3)
  })
  it('handles JSONB-as-string', () => {
    expect(playedCount('[4,0,5]')).toBe(2)
  })
  it('garbage → 0', () => {
    for (const bad of [null, undefined, 'x', '{}', 42, {}]) expect(playedCount(bad)).toBe(0)
  })
})

describe('isFullRound / isQualifying', () => {
  it('full 18 is full + qualifying', () => {
    const r = full18()
    expect(isFullRound(r)).toBe(true)
    expect(isQualifying(r)).toBe(true)
  })
  it('full 9-hole-course round is FULL, not partial', () => {
    const r = { total: 45, course_par: 36, scores: [5,5,5,5,5,5,5,5,5], hole_pars: [4,4,4,4,4,4,4,4,4] }
    expect(isFullRound(r)).toBe(true)
    expect(isQualifying(r)).toBe(true)
  })
  it('12-of-18 is partial but qualifying; 8-of-18 is neither', () => {
    const s12 = PARS18.map((p, i) => (i < 12 ? p : 0))
    expect(isFullRound({ scores: s12 })).toBe(false)
    expect(isQualifying({ scores: s12 })).toBe(true)
    const s8 = PARS18.map((p, i) => (i < 8 ? p : 0))
    expect(isQualifying({ scores: s8 })).toBe(false)
  })
  it('empty / missing scores → false', () => {
    expect(isFullRound({ scores: [] })).toBe(false)
    expect(isFullRound({})).toBe(false)
    expect(isQualifying({})).toBe(false)
  })
})

describe('parPlayed', () => {
  it('exact from hole_pars over played holes', () => {
    const scores = [5, 0, 4, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(parPlayed({ scores, hole_pars: PARS18, course_par: 72 })).toBe(4 + 3 + 4) // holes 1,3,5
  })
  it('pro-rates from course_par when hole_pars missing', () => {
    const scores = PARS18.map((p, i) => (i < 9 ? p : 0))
    expect(parPlayed({ scores, hole_pars: null, course_par: 72 })).toBe(36)
  })
  it('pro-rates when hole_pars malformed (wrong length / bad values)', () => {
    const scores = PARS18.map((p, i) => (i < 9 ? p : 0))
    expect(parPlayed({ scores, hole_pars: [4, 4], course_par: 72 })).toBe(36)
    expect(parPlayed({ scores, hole_pars: PARS18.map(() => 99), course_par: 72 })).toBe(36)
  })
  it('string NUMERIC / JSONB inputs coerce', () => {
    expect(parPlayed({ scores: '[4,0,4]', hole_pars: '[4,3,5]', course_par: '11' })).toBe(9)
  })
  it('null shields — no scores, no par', () => {
    expect(parPlayed({ scores: [0, 0], course_par: 72 })).toBe(null)
    expect(parPlayed({ scores: [4], course_par: 'x', hole_pars: null })).toBe(null)
  })
})

describe('toParThrough', () => {
  it('47 thru 10 on front-10 par 40 → +7', () => {
    const scores = [5,5,5,5,5,5,5,4,4,4, 0,0,0,0,0,0,0,0]
    const total = 47
    expect(toParThrough({ total, scores, hole_pars: PARS18, course_par: 72 })).toBe(47 - 40)
  })
  it('total<=0 or unparseable → null (never NaN)', () => {
    expect(toParThrough({ total: 0, scores: [4], course_par: 72 })).toBe(null)
    expect(toParThrough({ total: 'x', scores: [4], course_par: 72 })).toBe(null)
  })
})

describe('equiv18', () => {
  it('PARITY: full 18-hole round returns the raw total EXACTLY', () => {
    for (const over of [0, 7, 10, 28]) {
      const r = full18(over)
      expect(equiv18(r)).toBe(r.total)
    }
  })
  it('parity holds with string total (pg NUMERIC)', () => {
    const r = full18(10)
    expect(equiv18({ ...r, total: String(r.total) })).toBe(r.total)
  })
  it('full 9-hole-course round doubles: 45 on par-36 → 90', () => {
    const r = { total: 45, course_par: 36, scores: [5,5,5,5,5,5,5,5,5], hole_pars: [4,4,4,4,4,4,4,4,4] }
    expect(equiv18(r)).toBe(90)
  })
  it('partial: +7 thru 10 → 72 + 7/10×18 = 84.6', () => {
    const scores = [5,5,5,5,5,5,5,4,4,4, 0,0,0,0,0,0,0,0]
    expect(equiv18({ total: 47, scores, hole_pars: PARS18, course_par: 72 })).toBe(84.6)
  })
  it('partial with missing hole_pars pro-rates and still computes', () => {
    const scores = PARS18.map((p, i) => (i < 9 ? p + 1 : 0)) // 9 holes, +9 on par 36 → 45
    const v = equiv18({ total: 45, scores, hole_pars: null, course_par: 72 })
    expect(v).toBe(90) // +9/9×18 + 72 = 18+72
  })
  it('zero played / zero total / empty → null, never NaN or Infinity', () => {
    expect(equiv18({ total: 0, scores: [0,0], course_par: 72 })).toBe(null)
    expect(equiv18({ total: 40, scores: [], course_par: 72 })).toBe(null)
    expect(equiv18({})).toBe(null)
  })
})

describe('par18', () => {
  it('18-hole course → course_par; 9-hole course → doubled', () => {
    expect(par18({ scores: PARS18, course_par: 72 })).toBe(72)
    expect(par18({ scores: [4,4,4,4,4,4,4,4,4], course_par: 36 })).toBe(72)
  })
})
