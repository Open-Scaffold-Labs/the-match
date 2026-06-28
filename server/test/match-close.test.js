// Parity tests for the batched /end helpers (Track F.6 / audit N4).
// These guard that the array-building helpers produce EXACTLY the pairs and
// results the old nested-loop implementation did — including the two real bugs
// in this path's history (missed non-leader pairs; tie handling).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { buildPairRows, computeResults } = require('../src/lib/match-close.js')

// Reference implementation = the ORIGINAL nested loop, kept here so the test
// proves byte-for-byte parity rather than re-asserting the new code's output.
function refPairs(parts) {
  const rows = []
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j]
      rows.push({
        winner: a.user_id, loser: b.user_id,
        tie: a.total === b.total, ws: a.total, ls: b.total,
      })
    }
  }
  return rows
}
function rowsFromArrays(r) {
  return r.winnerIds.map((w, k) => ({
    winner: w, loser: r.loserIds[k], tie: r.isTies[k],
    ws: r.winnerScores[k], ls: r.loserScores[k],
  }))
}

describe('match-close.buildPairRows', () => {
  it('produces every N-choose-2 pair (the 2026-05-07 missed-pair bug)', () => {
    // Matt 82, Dan 92, James 94 — outing 67. Must include (Dan,James).
    const parts = [
      { user_id: 1, total: 82 },
      { user_id: 2, total: 92 },
      { user_id: 3, total: 94 },
    ]
    const r = buildPairRows(parts)
    expect(r.winnerIds.length).toBe(3) // 3-choose-2
    expect(rowsFromArrays(r)).toEqual(refPairs(parts))
    // (Dan,James) pair present and non-tie
    const danJames = rowsFromArrays(r).find(x => x.winner === 2 && x.loser === 3)
    expect(danJames).toBeTruthy()
    expect(danJames.tie).toBe(false)
  })

  it('flags ties correctly (the 2026-06-23 all-zero tie crash)', () => {
    const parts = [
      { user_id: 1, total: 0 },
      { user_id: 2, total: 0 },
      { user_id: 3, total: 0 },
    ]
    const r = buildPairRows(parts)
    expect(r.isTies).toEqual([true, true, true])
    // winner/loser ids still both populated on a tie (NOT NULL constraint)
    expect(r.winnerIds.every(x => x != null)).toBe(true)
    expect(r.loserIds.every(x => x != null)).toBe(true)
  })

  it('matches the reference loop for a larger field', () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({ user_id: i + 1, total: 70 + i }))
    const r = buildPairRows(parts)
    expect(r.winnerIds.length).toBe(66) // 12-choose-2
    expect(rowsFromArrays(r)).toEqual(refPairs(parts))
  })

  it('empty / single participant → no pairs', () => {
    expect(buildPairRows([]).winnerIds.length).toBe(0)
    expect(buildPairRows([{ user_id: 1, total: 80 }]).winnerIds.length).toBe(0)
  })
})

describe('match-close.computeResults', () => {
  it('unique low total → that player wins, others lose', () => {
    const parts = [
      { id: 10, user_id: 1, total: 82 },
      { id: 11, user_id: 2, total: 92 },
      { id: 12, user_id: 3, total: 94 },
    ]
    const { ids, results } = computeResults(parts)
    expect(ids).toEqual([10, 11, 12])
    expect(results).toEqual(['win', 'loss', 'loss'])
  })

  it('shared low total → tie for all who share it', () => {
    const parts = [
      { id: 10, user_id: 1, total: 80 },
      { id: 11, user_id: 2, total: 80 },
      { id: 12, user_id: 3, total: 90 },
    ]
    const { results } = computeResults(parts)
    expect(results).toEqual(['tie', 'tie', 'loss'])
  })

  it('empty → empty arrays', () => {
    expect(computeResults([])).toEqual({ ids: [], results: [] })
  })
})
