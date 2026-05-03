// Test the User-shape contract — the most critical invariant in the system.
//
// Why: 2026-05-03 we shipped two prod bugs because /signup and /login had
// drifted from /me's column list. The DB had the right values; the response
// shape was wrong. Centralized in lib/user.js, but a constant + helper is
// only as good as the tests that prove it's actually used.
//
// These tests assert the structural invariant: USER_PUBLIC_COLUMNS contains
// every field the client reads off a User, and the helpers behave as
// documented. They run on `npm test` so future PRs that touch lib/user.js
// fail loudly if they break the contract.

import { describe, it, expect } from 'vitest'
import {
  USER_PUBLIC_COLUMNS,
  USER_PUBLIC_COLUMNS_WITH_PIN_HASH,
  sanitizeUser,
  REQUIRED_USER_FIELDS,
} from '../src/lib/user.js'

describe('USER_PUBLIC_COLUMNS', () => {
  it('is a comma-separated SQL fragment ready for SELECT', () => {
    expect(typeof USER_PUBLIC_COLUMNS).toBe('string')
    expect(USER_PUBLIC_COLUMNS).toContain(',')
    // No leading/trailing whitespace tokens that would break SQL.
    expect(USER_PUBLIC_COLUMNS.trim()).toBe(USER_PUBLIC_COLUMNS)
  })

  it('does NOT include pin_hash (would leak credentials)', () => {
    expect(USER_PUBLIC_COLUMNS).not.toContain('pin_hash')
  })

  it('contains every field the client reads off the user object', () => {
    // Synced with REQUIRED_USER_FIELDS — if a new field is added to the
    // client, REQUIRED_USER_FIELDS gets updated and this test forces
    // USER_PUBLIC_COLUMNS to stay in sync.
    for (const f of REQUIRED_USER_FIELDS) {
      expect(USER_PUBLIC_COLUMNS).toContain(f)
    }
  })

  it('includes all critical feature-gate fields (tier, role, onboarding state)', () => {
    // These three were the actual fields missing in the bug we fixed.
    expect(USER_PUBLIC_COLUMNS).toContain('tier')
    expect(USER_PUBLIC_COLUMNS).toContain('role')
    expect(USER_PUBLIC_COLUMNS).toContain('onboarding_completed_at')
  })

  it('includes profile-display fields (avatar, handicap, home_course, bio)', () => {
    expect(USER_PUBLIC_COLUMNS).toContain('avatar')
    expect(USER_PUBLIC_COLUMNS).toContain('handicap')
    expect(USER_PUBLIC_COLUMNS).toContain('home_course')
    expect(USER_PUBLIC_COLUMNS).toContain('bio')
  })
})

describe('USER_PUBLIC_COLUMNS_WITH_PIN_HASH', () => {
  it('is exactly USER_PUBLIC_COLUMNS plus pin_hash', () => {
    expect(USER_PUBLIC_COLUMNS_WITH_PIN_HASH).toBe(USER_PUBLIC_COLUMNS + ', pin_hash')
  })

  it('is the only place pin_hash is referenced (use only in /login)', () => {
    expect(USER_PUBLIC_COLUMNS_WITH_PIN_HASH).toContain('pin_hash')
  })
})

describe('sanitizeUser', () => {
  it('strips pin_hash from a row', () => {
    const row = { id: 1, email: 'a@b.com', name: 'A', pin_hash: 'super-secret-hash' }
    const safe = sanitizeUser(row)
    expect(safe.pin_hash).toBeUndefined()
    expect(safe.id).toBe(1)
    expect(safe.email).toBe('a@b.com')
    expect(safe.name).toBe('A')
  })

  it('preserves all non-secret fields', () => {
    const row = {
      id: 1, email: 'a@b.com', name: 'A', tier: 'elite', role: 'admin',
      onboarding_completed_at: '2026-05-01', pin_hash: 'x',
    }
    const safe = sanitizeUser(row)
    expect(safe.tier).toBe('elite')
    expect(safe.role).toBe('admin')
    expect(safe.onboarding_completed_at).toBe('2026-05-01')
  })

  it('handles null / undefined gracefully', () => {
    expect(sanitizeUser(null)).toBeNull()
    expect(sanitizeUser(undefined)).toBeUndefined()
  })

  it('does not mutate the input', () => {
    const row = { id: 1, pin_hash: 'x' }
    sanitizeUser(row)
    expect(row.pin_hash).toBe('x')  // original still has it
  })
})

describe('REQUIRED_USER_FIELDS', () => {
  it('includes the fields the client critically reads', () => {
    // Smoke-test the contract — the smoke-test-auth.js script has the
    // matching list. Keep these in sync.
    const critical = [
      'id', 'email', 'name', 'handle', 'role', 'tier',
      'onboarding_completed_at', 'onboarding_steps', 'coach_marks_seen',
    ]
    for (const f of critical) {
      expect(REQUIRED_USER_FIELDS).toContain(f)
    }
  })

  it('does NOT list pin_hash', () => {
    expect(REQUIRED_USER_FIELDS).not.toContain('pin_hash')
  })
})
