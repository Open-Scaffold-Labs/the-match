// F.5 S3 — unit coverage for the pure parts of the idempotency engine.
// The transactional claim/replay/concurrency behavior is verified against a
// real Postgres in the sandbox harness (see wiki/synthesis/
// f5-s2-s3-build-spec-2026-06-28.md); here we lock down the body-hash, which
// is what catches "same key, different request" and must be stable across
// object key order so a replayed body always matches the original.

import { describe, it, expect } from 'vitest'
import { hashBody } from '../src/lib/idempotency.js'

describe('hashBody', () => {
  it('is stable across object key order', () => {
    expect(hashBody({ hole: 5, score: 4, user_id: 100 }))
      .toBe(hashBody({ user_id: 100, score: 4, hole: 5 }))
  })

  it('changes when any value changes (catches key reuse w/ different body)', () => {
    const base = hashBody({ hole: 5, score: 4 })
    expect(hashBody({ hole: 5, score: 5 })).not.toBe(base) // different score
    expect(hashBody({ hole: 6, score: 4 })).not.toBe(base) // different hole
    expect(hashBody({ hole: 5, score: 4, force: true })).not.toBe(base) // added field
  })

  it('treats null/undefined/empty body as a stable empty hash', () => {
    const empty = hashBody({})
    expect(hashBody(null)).toBe(empty)
    expect(hashBody(undefined)).toBe(empty)
  })

  it('returns a sha256 hex digest (64 chars)', () => {
    expect(hashBody({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })
})
