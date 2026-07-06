// Integrity rules for live outing putt capture (spec §2 — risks P3/P8).
import { describe, it, expect } from 'vitest'
import { cleanPuttEntry, setPuttAtHole, cleanPuttArraysForRound } from '../src/lib/puttFacts'

describe('cleanPuttEntry', () => {
  it('accepts a normal entry', () => {
    expect(cleanPuttEntry(2, '3-10', 5)).toEqual({ putts: 2, firstPutt: '3-10' })
  })
  it('accepts 0 putts (holed out from off the green) and drops the bucket', () => {
    expect(cleanPuttEntry(0, 'in3', 3)).toEqual({ putts: 0, firstPutt: null })
  })
  it('drops a count above the hole score (solo parity rule)', () => {
    expect(cleanPuttEntry(4, 'in3', 3)).toEqual({ putts: null, firstPutt: null })
  })
  it('drops counts outside 0..6, non-ints, and garbage', () => {
    for (const bad of [7, -1, 2.5, 'x', {}, [], NaN]) {
      expect(cleanPuttEntry(bad, 'in3', 8).putts).toBe(null)
    }
  })
  it('drops an unknown bucket but keeps the count', () => {
    expect(cleanPuttEntry(2, 'yolo', 5)).toEqual({ putts: 2, firstPutt: null })
  })
  it('null putts → all null (absent is not zero)', () => {
    expect(cleanPuttEntry(null, 'in3', 5)).toEqual({ putts: null, firstPutt: null })
  })
  it('invalid score drops everything', () => {
    expect(cleanPuttEntry(2, 'in3', null)).toEqual({ putts: null, firstPutt: null })
  })
})

describe('setPuttAtHole', () => {
  it('writes sparse-safely at an index beyond current length', () => {
    const r = setPuttAtHole(null, null, 3, { putts: 2, firstPutt: 'in3' })
    expect(r.putts).toEqual([null, null, null, 2])
    expect(r.firstPutts).toEqual([null, null, null, 'in3'])
  })
  it('overwrites an existing hole without touching neighbours', () => {
    const r = setPuttAtHole([1, 2], ['in3', '3-10'], 1, { putts: 3, firstPutt: '25plus' })
    expect(r.putts).toEqual([1, 3])
    expect(r.firstPutts).toEqual(['in3', '25plus'])
  })
})

describe('cleanPuttArraysForRound (fan-out re-clean — risk P3)', () => {
  it('nulls a count that a conflict-lowered score invalidated', () => {
    const r = cleanPuttArraysForRound([4, 3], [2, 4], ['in3', '3-10'])
    expect(r.putts).toEqual([2, null])
    expect(r.firstPutts).toEqual(['in3', null])
  })
  it('returns null arrays when nothing usable survives', () => {
    expect(cleanPuttArraysForRound([3, 4], [4, null], [null, null])).toEqual({ putts: null, firstPutts: null })
  })
  it('handles missing first_putts array', () => {
    const r = cleanPuttArraysForRound([4, 5], [2, 1], null)
    expect(r.putts).toEqual([2, 1])
    expect(r.firstPutts).toEqual([null, null])
  })
  it('no putt array at all → nulls', () => {
    expect(cleanPuttArraysForRound([4, 5], null, null)).toEqual({ putts: null, firstPutts: null })
  })
})
