// Backend-origin single-source-of-truth + drift guards.
//
// Origin story (2026-07-17): a native TestFlight build shipped with NO API
// origin because it came only from a build-time env var living in one person's
// shell — every backend call, sign-in included, died against
// capacitor://localhost. The same value was ALSO hardcoded in three other
// places. These tests make that class of failure impossible to reintroduce
// silently: the rule is pinned, and the copies that CANNOT import the constant
// (static JSON) are asserted to match it.
//
// Run: node --test client/src/lib/__tests__/backend-origin.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { BACKEND_ORIGIN, resolveApiOrigin } from '../backend-origin.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../..')          // …/the-match
const read = p => readFileSync(resolve(REPO, p), 'utf8')

test('BACKEND_ORIGIN is an absolute https origin with no trailing slash', () => {
  assert.match(BACKEND_ORIGIN, /^https:\/\/[^/]+$/)
})

// ── The rule ────────────────────────────────────────────────────────────────

test('native build with NO env origin still gets an absolute origin (the bug)', () => {
  const origin = resolveApiOrigin({ envOrigin: undefined, isNative: true })
  assert.equal(origin, BACKEND_ORIGIN)
  // The actual production failure was an EMPTY origin in a native build:
  // relative /api → capacitor://localhost/api → CapacitorHttp throws.
  assert.notEqual(origin, '')
  assert.match(origin, /^https:\/\//)
})

test('web build with no env origin stays same-origin ("") — unchanged behavior', () => {
  assert.equal(resolveApiOrigin({ envOrigin: undefined, isNative: false }), '')
  assert.equal(resolveApiOrigin({}), '')
})

test('an explicit env origin always wins (staging / local / preview)', () => {
  assert.equal(
    resolveApiOrigin({ envOrigin: 'https://staging.example.com', isNative: true }),
    'https://staging.example.com',
  )
  assert.equal(
    resolveApiOrigin({ envOrigin: 'https://staging.example.com', isNative: false }),
    'https://staging.example.com',
  )
})

test('trailing slashes are stripped so callers can concatenate "/api/…"', () => {
  assert.equal(resolveApiOrigin({ envOrigin: 'https://x.dev///' }), 'https://x.dev')
  // Blank/whitespace env must not defeat the native fallback.
  assert.equal(resolveApiOrigin({ envOrigin: '   ', isNative: true }), BACKEND_ORIGIN)
  assert.equal(resolveApiOrigin({ envOrigin: '', isNative: true }), BACKEND_ORIGIN)
})

// ── Drift guards for copies that cannot import the constant ─────────────────

test('capacitor.config.json OTA urls point at BACKEND_ORIGIN (static JSON — cannot import)', () => {
  const cfg = JSON.parse(read('client/capacitor.config.json'))
  const { updateUrl, statsUrl } = cfg.plugins.CapacitorUpdater
  assert.ok(updateUrl.startsWith(BACKEND_ORIGIN), `updateUrl drifted: ${updateUrl}`)
  assert.ok(statsUrl.startsWith(BACKEND_ORIGIN), `statsUrl drifted: ${statsUrl}`)
})

test('ota-publish.mjs takes its origin from the constant, not a local literal', () => {
  const src = read('scripts/ota-publish.mjs')
  assert.ok(
    /import\s*\{[^}]*BACKEND_ORIGIN[^}]*\}\s*from\s*['"].*backend-origin\.js['"]/.test(src),
    'ota-publish.mjs must import BACKEND_ORIGIN',
  )
  assert.ok(
    src.includes('process.env.VITE_API_ORIGIN || BACKEND_ORIGIN'),
    'ota-publish.mjs must default VITE_API_ORIGIN to BACKEND_ORIGIN',
  )
})

test('api.js resolves its origin through the shared pure rule (no local literal)', () => {
  const src = read('client/src/lib/api.js')
  assert.ok(
    /import\s*\{[^}]*resolveApiOrigin[^}]*\}\s*from\s*['"]\.\/backend-origin\.js['"]/.test(src),
    'api.js must import resolveApiOrigin',
  )
  assert.ok(src.includes('resolveApiOrigin({'), 'api.js must call resolveApiOrigin')
  // No second hardcoded copy of the origin hiding in api.js.
  assert.ok(
    !src.includes(BACKEND_ORIGIN),
    'api.js must not hardcode the origin — import BACKEND_ORIGIN instead',
  )
})
