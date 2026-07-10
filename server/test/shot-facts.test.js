// Integrity rules for live outing SHOT capture (migration 042) + proof that a
// cleaned shot log feeds the read-time SG engine into OTT/APP/ARG. Sibling of
// putt-facts.test.js.
import { describe, it, expect } from 'vitest'
import { cleanHoleShots, setShotsAtHole, cleanShotsForRound } from '../src/lib/shotFacts.js'
import { holeShotsSG } from '../src/lib/sg/index.js'

describe('cleanHoleShots', () => {
  it('keeps valid {lie, toPin} shots and rounds the distance; preserves club', () => {
    expect(cleanHoleShots([{ club: 'Dr', lie: 'tee', toPin: 401.6 }]))
      .toEqual([{ lie: 'tee', toPin: 402, club: 'Dr' }])
  })
  it('drops shots with an unknown lie', () => {
    expect(cleanHoleShots([{ lie: 'ocean', toPin: 150 }])).toBe(null)
  })
  it('drops shots with a non-positive / non-numeric toPin', () => {
    for (const bad of [0, -5, NaN, 'x', undefined]) {
      expect(cleanHoleShots([{ lie: 'fairway', toPin: bad }])).toBe(null)
    }
  })
  it('drops garbage entries but keeps the good ones', () => {
    expect(cleanHoleShots([null, 3, { lie: 'rough', toPin: 90 }, {}]))
      .toEqual([{ lie: 'rough', toPin: 90 }])
  })
  it('non-array / empty → null (absent is not [])', () => {
    for (const bad of [null, undefined, 'x', 42, []]) expect(cleanHoleShots(bad)).toBe(null)
  })
  // Phase 3 (2026-07-10): editor pin positions ride along, finite-gated.
  it('keeps a finite {lat, lon} pin position; strips partial/garbage positions', () => {
    expect(cleanHoleShots([{ lie: 'tee', toPin: 300, lat: 40.66, lon: -74.11 }]))
      .toEqual([{ lie: 'tee', toPin: 300, lat: 40.66, lon: -74.11 }])
    expect(cleanHoleShots([{ lie: 'tee', toPin: 300, lat: 40.66 }]))          // half a pair
      .toEqual([{ lie: 'tee', toPin: 300 }])
    expect(cleanHoleShots([{ lie: 'tee', toPin: 300, lat: 'x', lon: -74 }]))  // garbage lat
      .toEqual([{ lie: 'tee', toPin: 300 }])
  })
})

describe('setShotsAtHole', () => {
  it('writes sparse-safely at an index beyond current length', () => {
    expect(setShotsAtHole(null, 2, [{ lie: 'tee', toPin: 300 }]))
      .toEqual([null, null, [{ lie: 'tee', toPin: 300 }]])
  })
  it('overwrites one hole without touching neighbours', () => {
    const existing = [[{ lie: 'tee', toPin: 300 }], null]
    expect(setShotsAtHole(existing, 1, [{ lie: 'fairway', toPin: 120 }]))
      .toEqual([[{ lie: 'tee', toPin: 300 }], [{ lie: 'fairway', toPin: 120 }]])
  })
  it('an all-empty log collapses to null (stores as SQL null, never [])', () => {
    expect(setShotsAtHole([null, null], 0, null)).toBe(null)
  })
  it('rejects a bad hole index without corrupting existing data', () => {
    expect(setShotsAtHole([[{ lie: 'tee', toPin: 300 }]], -1, [{ lie: 'tee', toPin: 1 }]))
      .toEqual([[{ lie: 'tee', toPin: 300 }]])
  })
})

describe('cleaned shots → SG engine (the whole point)', () => {
  it('a complete cleaned chain populates OTT + APP', () => {
    // Par 4, score 4 = 2 shots + 2 putts. Tee shot → OTT; 150-yd approach → APP.
    const shots = cleanHoleShots([
      { club: 'Dr', lie: 'tee', toPin: 400 },
      { club: '7i', lie: 'fairway', toPin: 150 },
    ])
    const cat = holeShotsSG('tour', { par: 4, score: 4, shots, putts: 2, firstPuttBucket: '3-10' })
    expect(cat.sgOTT).not.toBeNull()
    expect(cat.sgAPP).not.toBeNull()
    expect(cat.sgOTT).not.toBe(0) // the tee shot actually landed in OTT
  })
  it('a short greenside shot lands in ARG', () => {
    // Par 4, score 5 = 3 shots + 2 putts. Third shot 20 yds (<=30) → ARG.
    const shots = cleanHoleShots([
      { lie: 'tee', toPin: 400 },
      { lie: 'rough', toPin: 150 },
      { lie: 'sand', toPin: 20 },
    ])
    const cat = holeShotsSG('tour', { par: 4, score: 5, shots, putts: 2, firstPuttBucket: 'in3' })
    expect(cat.sgARG).not.toBeNull()
    expect(cat.sgARG).not.toBe(0)
  })
  it('an incomplete chain (shots + putts ≠ score) contributes nothing — never fabricates', () => {
    const shots = cleanHoleShots([{ lie: 'tee', toPin: 400 }])
    const cat = holeShotsSG('tour', { par: 4, score: 4, shots, putts: 2, firstPuttBucket: '3-10' })
    expect(cat).toEqual({ sgOTT: null, sgAPP: null, sgARG: null })
  })
  // Phase 3 (2026-07-10): the decision to persist editor pin positions rests
  // on SG being provably indifferent to them — pin it with a test.
  it('SG output is identical with and without persisted pin positions', () => {
    const bare = cleanHoleShots([
      { lie: 'tee', toPin: 400 },
      { lie: 'fairway', toPin: 150 },
    ])
    const withPos = cleanHoleShots([
      { lie: 'tee', toPin: 400, lat: 40.661, lon: -74.112 },
      { lie: 'fairway', toPin: 150, lat: 40.663, lon: -74.114 },
    ])
    const args = { par: 4, score: 4, putts: 2, firstPuttBucket: '3-10' }
    expect(holeShotsSG('tour', { ...args, shots: withPos }))
      .toEqual(holeShotsSG('tour', { ...args, shots: bare }))
  })
})

describe('cleanShotsForRound (solo POST /rounds hygiene)', () => {
  it('cleans each hole; empty/garbage holes → null, keeps good shots', () => {
    expect(cleanShotsForRound([
      [{ club: 'Dr', lie: 'tee', toPin: 400.4 }],
      [{ lie: 'ocean', toPin: 10 }],   // bad lie → hole null
      [],                               // empty → null
      [{ lie: 'fairway', toPin: 150 }],
    ])).toEqual([
      [{ lie: 'tee', toPin: 400, club: 'Dr' }],
      null,
      null,
      [{ lie: 'fairway', toPin: 150 }],
    ])
  })
  it('non-array → null; an all-empty round → null (never [])', () => {
    expect(cleanShotsForRound(null)).toBe(null)
    expect(cleanShotsForRound([[], [{ lie: 'x', toPin: 0 }], null])).toBe(null)
  })
})
