// Partial-rounds spec (2026-07-16) §4 D5 / §5-11 — putt & shot facts must
// never survive on an UNPLAYED hole (score 0/null): the SG engine cannot be
// allowed to grade a hole the player didn't count.
import { describe, it, expect } from 'vitest'
import { cleanPuttEntry, cleanPuttArraysForRound } from '../src/lib/puttFacts'
import { cleanShotsForRound } from '../src/lib/shotFacts'

describe('putt facts on unplayed holes', () => {
  it('score 0 drops even a 0-putt entry (phantom "holed from off green")', () => {
    expect(cleanPuttEntry(0, 'in3', 0)).toEqual({ putts: null, firstPutt: null })
    expect(cleanPuttEntry(2, 'in3', 0)).toEqual({ putts: null, firstPutt: null })
  })
  it('normal entries on scored holes still pass', () => {
    expect(cleanPuttEntry(2, '3-10', 5)).toEqual({ putts: 2, firstPutt: '3-10' })
    expect(cleanPuttEntry(0, 'in3', 3)).toEqual({ putts: 0, firstPutt: null })
  })
  it('fan-out clean nulls facts on the unplayed holes of a partial', () => {
    const scores = [4, 0, 5]
    const out = cleanPuttArraysForRound(scores, [2, 1, 2], ['in3', 'in3', '3-10'])
    expect(out.putts).toEqual([2, null, 2])
    expect(out.firstPutts).toEqual(['in3', null, '3-10'])
  })
})

describe('shot facts on unplayed holes', () => {
  const shot = { lie: 'fairway', toPin: 150 }
  it('scores passed → unplayed holes cleaned to null', () => {
    const out = cleanShotsForRound([[shot], [shot], [shot]], [4, 0, 5])
    expect(out[0]).not.toBe(null)
    expect(out[1]).toBe(null)
    expect(out[2]).not.toBe(null)
  })
  it('all holes unplayed → null (store nothing, not [])', () => {
    expect(cleanShotsForRound([[shot], [shot]], [0, 0])).toBe(null)
  })
  it('no scores passed (legacy callers) → old behavior unchanged', () => {
    const out = cleanShotsForRound([[shot], [shot]])
    expect(out[0]).not.toBe(null)
    expect(out[1]).not.toBe(null)
  })
})
