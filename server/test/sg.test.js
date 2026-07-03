// SG math — unit tests (docs/SG-DESIGN.md).
// Worked examples follow Broadie's published tour-table conventions.

import { describe, it, expect } from 'vitest'
import {
  expectedStrokes, resolveBaseline, bandForHandicap, roundGapVsTour, BASELINE_IDS, LIES,
} from '../src/lib/sg/baselines.js'
import {
  shotSG, holePuttSG, holeShotsSG, roundSG, aggregateSG, FIRST_PUTT_BUCKETS,
  appBucketBreakdown, sgPromptBlock,
} from '../src/lib/sg/index.js'

describe('baselines: expectedStrokes', () => {
  it('matches tour anchors exactly at anchor points', () => {
    expect(expectedStrokes('tour', 'tee', 400)).toBeCloseTo(3.99, 2)
    expect(expectedStrokes('tour', 'fairway', 100)).toBeCloseTo(2.80, 2)
    expect(expectedStrokes('tour', 'green', 8)).toBeCloseTo(1.50, 2)
    expect(expectedStrokes('tour', 'green', 33)).toBeCloseTo(2.0, 1) // ~2-putt territory
  })

  it('interpolates between anchors and clamps at the ends', () => {
    const mid = expectedStrokes('tour', 'fairway', 150) // between 140 (2.91) and 160 (2.98)
    expect(mid).toBeGreaterThan(2.91)
    expect(mid).toBeLessThan(2.98)
    expect(expectedStrokes('tour', 'green', 0.5)).toBeCloseTo(1.001, 3) // clamp low
    expect(expectedStrokes('tour', 'tee', 700)).toBeCloseTo(4.82, 2)   // clamp high
  })

  it('holed ball costs 0 from any lie', () => {
    for (const lie of LIES) expect(expectedStrokes('tour', lie, 0)).toBe(0)
  })

  it('is monotone non-decreasing in distance for fairway/rough/green (tee + sand have real published dips)', () => {
    // Broadie's tour tables are legitimately non-monotonic at short tee
    // distances (a 120-yd par-3 tee shot expects MORE than 140 — awkward
    // partial-wedge territory) and mid-range sand. Don't "fix" the data.
    for (const b of BASELINE_IDS) {
      for (const lie of ['fairway', 'rough', 'green']) {
        let prev = 0
        for (let d = 5; d <= (lie === 'green' ? 90 : 320); d += 5) {
          const e = expectedStrokes(b, lie, d)
          expect(e).toBeGreaterThanOrEqual(prev - 1e-9)
          prev = e
        }
      }
    }
  })

  it('higher handicap band ⇒ strictly more expected strokes (off-green)', () => {
    const order = ['tour', 'scratch', 'hcp-5', 'hcp-10', 'hcp-15', 'hcp-20']
    for (let i = 1; i < order.length; i++) {
      expect(expectedStrokes(order[i], 'fairway', 150))
        .toBeGreaterThan(expectedStrokes(order[i - 1], 'fairway', 150))
    }
  })

  it('rough costs more than fairway; sand more than rough (short range)', () => {
    expect(expectedStrokes('tour', 'rough', 150)).toBeGreaterThan(expectedStrokes('tour', 'fairway', 150))
    expect(expectedStrokes('tour', 'sand', 60)).toBeGreaterThan(expectedStrokes('tour', 'rough', 60))
  })

  it('rejects unknown lies and baselines', () => {
    expect(() => expectedStrokes('tour', 'cartpath', 50)).toThrow()
    expect(() => expectedStrokes('lpga', 'fairway', 50)).toThrow()
  })

  it('band gaps vs tour land exactly on the calibration targets', () => {
    expect(roundGapVsTour('tour')).toBe(0)
    expect(roundGapVsTour('scratch')).toBeCloseTo(3.5, 5)
    expect(roundGapVsTour('hcp-5')).toBeCloseTo(8.0, 5)
    expect(roundGapVsTour('hcp-10')).toBeCloseTo(13.0, 5)
    expect(roundGapVsTour('hcp-15')).toBeCloseTo(18.5, 5)
    expect(roundGapVsTour('hcp-20')).toBeCloseTo(24.0, 5)
  })

  it('calibrated multipliers stay sane (no band loses >40% per shot off-green)', () => {
    for (const b of ['scratch', 'hcp-5', 'hcp-10', 'hcp-15', 'hcp-20']) {
      for (const lie of ['tee', 'fairway', 'rough', 'sand']) {
        const ratio = expectedStrokes(b, lie, 150) / expectedStrokes('tour', lie, 150)
        expect(ratio).toBeGreaterThan(1)
        expect(ratio).toBeLessThan(1.4)
      }
    }
  })
})

describe('baseline resolution', () => {
  it('bandForHandicap maps index → band', () => {
    expect(bandForHandicap(0)).toBe('scratch')
    expect(bandForHandicap(6)).toBe('hcp-5')
    expect(bandForHandicap(11.2)).toBe('hcp-10')
    expect(bandForHandicap(17)).toBe('hcp-15')
    expect(bandForHandicap(24)).toBe('hcp-20')
    expect(bandForHandicap(null)).toBe('hcp-15') // unknown → modest default
  })

  it("explicit setting wins; 'auto' resolves from handicap", () => {
    expect(resolveBaseline('tour', 18)).toBe('tour')
    expect(resolveBaseline('auto', 18)).toBe('hcp-20')
    expect(resolveBaseline(undefined, 4)).toBe('hcp-5')
  })
})

describe('shotSG (phase-2 path)', () => {
  it('Broadie worked example: holed 8-footer gains ~+0.5', () => {
    expect(shotSG('tour', { lie: 'green', toPin: 8 }, null)).toBeCloseTo(0.5, 1)
  })

  it('a dead-average shot gains ~0', () => {
    // tour fairway 140 (2.91) hit to 20 ft (1.87): 2.91 − 1.87 − 1 = +0.04
    expect(shotSG('tour', { lie: 'fairway', toPin: 140 }, { lie: 'green', toPin: 20 }))
      .toBeCloseTo(0.04, 2)
  })

  it('penalty strokes subtract', () => {
    const sg = shotSG('tour', { lie: 'tee', toPin: 400 }, { lie: 'tee', toPin: 400 }, 1)
    expect(sg).toBeCloseTo(-2, 5) // re-tee with penalty: lost two strokes
  })
})

describe('holePuttSG', () => {
  it('two putts from 10–25 ft is roughly neutral on tour', () => {
    // E[16 ft] ≈ 1.80 → 2 putts ⇒ ≈ −0.2
    const sg = holePuttSG('tour', 2, '10-25')
    expect(sg).toBeGreaterThan(-0.3)
    expect(sg).toBeLessThan(0)
  })

  it('one-putt from 10–25 ft gains; three-putt loses', () => {
    expect(holePuttSG('tour', 1, '10-25')).toBeGreaterThan(0.5)
    expect(holePuttSG('tour', 3, '10-25')).toBeLessThan(-1)
  })

  it('amateur baselines are more forgiving than tour for the same putts', () => {
    expect(holePuttSG('hcp-15', 2, '10-25')).toBeGreaterThan(holePuttSG('tour', 2, '10-25'))
  })

  it('returns null without usable data; 0 putts (holed from off green) is 0', () => {
    expect(holePuttSG('tour', null, '3-10')).toBeNull()
    expect(holePuttSG('tour', 2, 'someday')).toBeNull()
    expect(holePuttSG('tour', 2, undefined)).toBeNull()
    expect(holePuttSG('tour', 0, undefined)).toBe(0)
  })

  it('every bucket has a representative distance', () => {
    for (const feet of Object.values(FIRST_PUTT_BUCKETS)) {
      expect(feet).toBeGreaterThan(0)
      expect(feet).toBeLessThan(90)
    }
  })
})

describe('roundSG (phase 1)', () => {
  const puttData18 = {
    putts: Array(18).fill(2),
    first_putts: Array(18).fill('10-25'),
  }

  it('an average round for the band scores ~0 SG:Total', () => {
    // hcp-10 expected ≈ (par − 2) + gap. Build a round that shoots exactly that.
    const expected = 72 - 2 + roundGapVsTour('hcp-10')
    const sg = roundSG(
      { total: Math.round(expected), course_par: 72, ...puttData18 },
      'hcp-10', null
    )
    expect(Math.abs(sg.sgTotal)).toBeLessThanOrEqual(0.5)
    expect(sg.baseline).toBe('hcp-10')
  })

  it('T2G + P decompose Total', () => {
    const sg = roundSG({ total: 85, course_par: 72, ...puttData18 }, 'hcp-10', null)
    expect(sg.sgP).not.toBeNull()
    expect(sg.sgT2G).not.toBeNull()
    expect(sg.sgP + sg.sgT2G).toBeCloseTo(sg.sgTotal, 1)
  })

  it('normalizes partial putt data to 18 holes, requires ≥9', () => {
    const nine = { putts: Array(9).fill(2), first_putts: Array(9).fill('10-25') }
    const sg9 = roundSG({ total: 85, course_par: 72, ...nine }, 'tour', null)
    expect(sg9.puttHolesCounted).toBe(9)
    expect(sg9.sgP).not.toBeNull()

    const eight = { putts: Array(8).fill(2), first_putts: Array(8).fill('10-25') }
    const sg8 = roundSG({ total: 85, course_par: 72, ...eight }, 'tour', null)
    expect(sg8.sgP).toBeNull()
    expect(sg8.sgTotal).not.toBeNull() // Total still works without putt data
  })

  it('uses course_rating over par when present', () => {
    const easy = roundSG({ total: 80, course_par: 72, course_rating: 69.0, ...puttData18 }, 'tour', null)
    const std = roundSG({ total: 80, course_par: 72, ...puttData18 }, 'tour', null)
    expect(easy.sgTotal).toBeLessThan(std.sgTotal) // easier course ⇒ same score is worth less
  })

  it('returns null for unusable rounds', () => {
    expect(roundSG({ total: 0, course_par: 72 }, 'tour', null)).toBeNull()
    expect(roundSG({ total: 85, course_par: null }, 'tour', null)).toBeNull()
  })
})

describe('holeShotsSG (phase 2 categorizer)', () => {
  // Textbook par 4: 400-yd tee shot to fairway 140, approach to 16 ft, 2 putts.
  const par4 = {
    par: 4, score: 4,
    shots: [
      { lie: 'tee', toPin: 400 },
      { lie: 'fairway', toPin: 140 },
    ],
    putts: 2, firstPuttBucket: '10-25',
  }

  it('splits a complete par-4 into OTT + APP', () => {
    const cat = holeShotsSG('tour', par4)
    // OTT = E(tee,400) − E(fw,140) − 1 = 3.99 − 2.91 − 1
    expect(cat.sgOTT).toBeCloseTo(0.08, 2)
    // APP = E(fw,140) − E(green,16ft) − 1
    expect(cat.sgAPP).toBeCloseTo(0.11, 1)
    expect(cat.sgARG).toBe(0)
  })

  it('invariant: OTT + APP + ARG + P === E[first shot] − score', () => {
    const cat = holeShotsSG('tour', par4)
    const p = holePuttSG('tour', 2, '10-25')
    const lhs = cat.sgOTT + cat.sgAPP + cat.sgARG + p
    const rhs = expectedStrokes('tour', 'tee', 400) - 4
    expect(lhs).toBeCloseTo(rhs, 1)
  })

  it('par-3 tee shot counts as APP, not OTT', () => {
    const cat = holeShotsSG('tour', {
      par: 3, score: 3,
      shots: [{ lie: 'tee', toPin: 175 }],
      putts: 2, firstPuttBucket: '10-25',
    })
    expect(cat.sgOTT).toBe(0)
    expect(cat.sgAPP).not.toBe(0)
    expect(cat.sgARG).toBe(0)
  })

  it('shots inside 30 yds go to ARG; holed-out chain (0 putts) works', () => {
    const cat = holeShotsSG('tour', {
      par: 4, score: 3,
      shots: [
        { lie: 'tee', toPin: 400 },
        { lie: 'fairway', toPin: 140 },
        { lie: 'sand', toPin: 20 },   // bunker shot... holed it (score 3, 0 putts)
      ],
      putts: 0, firstPuttBucket: null,
    })
    expect(cat.sgARG).toBeCloseTo(expectedStrokes('tour', 'sand', 20) - 1, 1) // holed: E − 0 − 1
    expect(cat.sgOTT).not.toBeNull()
  })

  it('incomplete chains produce NO category numbers', () => {
    // shots + putts ≠ score → user under-logged → no fake numbers
    expect(holeShotsSG('tour', { ...par4, score: 6 }).sgOTT).toBeNull()
    // putts present but no first-putt bucket → chain broken at the green
    expect(holeShotsSG('tour', { ...par4, firstPuttBucket: null }).sgOTT).toBeNull()
    // a shot missing toPin
    expect(holeShotsSG('tour', {
      ...par4, shots: [{ lie: 'tee', toPin: 400 }, { lie: 'fairway', toPin: null }],
    }).sgOTT).toBeNull()
    // no shots at all
    expect(holeShotsSG('tour', { ...par4, shots: [] }).sgOTT).toBeNull()
  })

  it('roundSG surfaces categories when ≥9 holes have complete chains', () => {
    const holes = 18
    const round = {
      total: 4 * holes, course_par: 72,
      scores: Array(holes).fill(4),
      hole_pars: Array(holes).fill(4),
      shots: Array(holes).fill([
        { lie: 'tee', toPin: 400 },
        { lie: 'fairway', toPin: 140 },
      ]),
      putts: Array(holes).fill(2),
      first_putts: Array(holes).fill('10-25'),
    }
    const sg = roundSG(round, 'tour', null)
    expect(sg.shotHolesCounted).toBe(18)
    expect(sg.sgOTT).toBeCloseTo(0.08 * 18, 0)
    expect(sg.sgAPP).not.toBeNull()
    expect(sg.sgARG).toBe(0)

    // Below the 9-hole coverage floor → categories null, P unaffected.
    const sparse = { ...round, shots: round.shots.slice(0, 5) }
    const sg2 = roundSG(sparse, 'tour', null)
    expect(sg2.sgOTT).toBeNull()
    expect(sg2.sgP).not.toBeNull()
  })
})

describe('aggregateSG', () => {
  it('averages across rounds and reports coverage', () => {
    const mk = (total, withPutts) => ({
      id: Math.random(), date: '2026-06-01', total, course_par: 72,
      ...(withPutts ? { putts: Array(18).fill(2), first_putts: Array(18).fill('10-25') } : {}),
    })
    const agg = aggregateSG([mk(85, true), mk(89, true), mk(91, false)], 'hcp-10', null)
    expect(agg.rounds).toBe(3)
    expect(agg.roundsWithPutting).toBe(2)
    expect(agg.sgTotal).not.toBeNull()
    expect(agg.sgP).not.toBeNull()
    expect(agg.series).toHaveLength(3)
  })
})

// ── Phase 3 ───────────────────────────────────────────────────────────────────

// A full 18-hole round with complete chains: 400-yd par 4s, approach from
// `appDist`, two putts from 10–25 ft. Reused by bucket + prompt tests.
function fullRound(appDist = 160) {
  return {
    id: Math.random(), date: '2026-06-01',
    total: 72, course_par: 72,
    scores: Array(18).fill(4),
    hole_pars: Array(18).fill(4),
    shots: Array(18).fill([
      { lie: 'tee', toPin: 400 },
      { lie: 'fairway', toPin: appDist },
    ]),
    putts: Array(18).fill(2),
    first_putts: Array(18).fill('10-25'),
  }
}

describe('appBucketBreakdown (phase 3)', () => {
  it('groups APP shots into start-distance buckets, worst first', () => {
    const rounds = [fullRound(160), fullRound(90)]
    const buckets = appBucketBreakdown(rounds, 'tour', null)
    const keys = buckets.map(b => b.bucket)
    expect(keys).toContain('150-175')
    expect(keys).toContain('75-125')
    for (const b of buckets) {
      expect(b.shots).toBe(18)
      expect(b.avgSG).toBeCloseTo(b.totalSG / b.shots, 2)
    }
    // worst-first ordering
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].avgSG).toBeGreaterThanOrEqual(buckets[i - 1].avgSG)
    }
  })

  it('returns [] with no complete chains', () => {
    const r = fullRound()
    r.shots = Array(18).fill([{ lie: 'tee', toPin: 400 }]) // chain ≠ score
    expect(appBucketBreakdown([r], 'tour', null)).toEqual([])
  })
})

describe('sgPromptBlock (phase 3 — the AI Caddie contract)', () => {
  it('formats the full block and names the baseline', () => {
    const block = sgPromptBlock([fullRound()], 'hcp-10', null)
    expect(block).toMatch(/^Strokes Gained \(last 1 rounds, baseline: hcp-10\)/)
    expect(block).toContain('Total ')
    expect(block).toContain('OTT ')
    expect(block).toContain('APP ')
    expect(block).toContain('P ')
  })

  it('includes the worst APP bucket only with a real sample (≥5 shots, negative)', () => {
    // 18 approaches from 160 vs tour — a high-handicap round at 72 strokes is
    // way ABOVE tour expectation here, so per-shot APP SG is positive → no
    // "worst" callout. Build a bad-APP round instead: approach to 25+ ft… the
    // simplest negative-APP construction is the tour baseline with extra
    // strokes: score 5s with a recovery detour.
    const bad = {
      ...fullRound(160),
      total: 90, scores: Array(18).fill(5),
      shots: Array(18).fill([
        { lie: 'tee', toPin: 400 },
        { lie: 'fairway', toPin: 160 },
        { lie: 'rough', toPin: 35 },     // missed the green → APP shot was bad
      ]),
    }
    const block = sgPromptBlock([bad], 'tour', null)
    expect(block).toContain('worst:')
  })

  it('returns null with no rounds / no signal', () => {
    expect(sgPromptBlock([], 'auto', 10)).toBeNull()
    expect(sgPromptBlock([{ id: 1, total: 0, course_par: 72 }], 'auto', 10)).toBeNull()
  })
})
