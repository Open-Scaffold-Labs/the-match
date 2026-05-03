#!/usr/bin/env node
/**
 * Smoke test — exercises every auth endpoint against a target deployment
 * and asserts the User response shape is correct.
 *
 * Why this exists: on 2026-05-03 we shipped two prod bugs because /signup
 * and /login had drifted from /me's column list. Login was missing
 * onboarding_completed_at (made every existing user re-see the wizard)
 * and tier (Matt — an `elite` admin — got a "free tier upgrade" wall on
 * leagues). The DB had the right values; the response shape was wrong.
 *
 * After today, the User shape is centralized in server/src/lib/user.js,
 * but a centralized helper isn't a guarantee — someone could still write
 * a route that hand-rolls a SELECT and returns part of a user object. So
 * this script asserts the contract on the wire, end-to-end.
 *
 * Usage:
 *   node scripts/smoke-test-auth.js                 # hits prod (the-match-roan.vercel.app)
 *   BASE=https://staging-url.vercel.app node ...   # hits another deploy
 *
 * Environment:
 *   DATABASE_URL — needed for the test-user DB ops (read tier, reset for cleanup)
 *   JWT_SECRET   — needed to mint the throwaway token used to hit /me
 *
 * Exit codes:
 *   0 — every assertion passed
 *   1 — one or more assertions failed
 *
 * The script is intentionally loud — every check prints a ✓/✗ so a
 * failure is obvious in the noise of a CI log.
 */

const fs = require('fs')
const path = require('path')

// Lazy-load env. /tmp/.env.prod (pulled from Vercel) wins over local .env
// because the smoke test hits PROD endpoints — must use prod JWT_SECRET so
// our manually-minted token validates server-side.
//
// IMPORTANT: vercel env pull writes values with embedded newlines escaped
// as `\n` (literal backslash-n), and quotes the value. We must:
//   1. Strip surrounding quotes
//   2. Decode \n / \r escape sequences back to real characters
// Otherwise process.env.JWT_SECRET on the server (real newline) won't
// match our local copy (literal `\n`), and signed tokens won't verify.
function loadEnv() {
  const sources = [
    { path: '/tmp/.env.prod', override: true },
    { path: path.join(__dirname, '..', '.env'), override: false },
  ]
  for (const { path: f, override } of sources) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/)
      if (!m) continue
      const key = m[1]
      if (!override && process.env[key]) continue
      let v = m[2].trim()
      // Quoted values: strip the surrounding quotes AND decode escapes
      // (only inside quotes, per dotenv spec). Unquoted values are taken
      // literally except for trailing whitespace.
      if (v.startsWith('"') && v.endsWith('"')) {
        v = v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\')
      } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.slice(1, -1)
      }
      process.env[key] = v
    }
  }
}
loadEnv()

const BASE = process.env.BASE || 'https://the-match-roan.vercel.app'
console.log(`\nSmoke-testing auth against: ${BASE}\n`)

// Required columns the contract guarantees on every User payload.
// Mirrors REQUIRED_USER_FIELDS in server/src/lib/user.js — keep in sync.
const REQUIRED_USER_FIELDS = [
  'id',
  'email',
  'name',
  'handle',
  'role',
  'tier',
  'onboarding_completed_at',
  'onboarding_steps',
  'coach_marks_seen',
]

// Fields that must NEVER appear in a public User payload (server-only).
const FORBIDDEN_USER_FIELDS = ['pin_hash']

let failures = 0
function check(label, ok, detail) {
  const mark = ok ? '✓' : '✗'
  const tag  = ok ? '  PASS' : 'FAIL'
  console.log(`${mark} ${tag}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures += 1
}

function assertUserShape(label, user) {
  check(`${label}: response includes a user object`, !!user)
  if (!user) return
  for (const f of REQUIRED_USER_FIELDS) {
    const has = Object.prototype.hasOwnProperty.call(user, f)
    check(`${label}: user.${f} is present`, has, has ? `value=${JSON.stringify(user[f])?.slice(0, 60)}` : 'MISSING')
  }
  for (const f of FORBIDDEN_USER_FIELDS) {
    const leaked = Object.prototype.hasOwnProperty.call(user, f)
    check(`${label}: user.${f} is NOT leaked to client`, !leaked, leaked ? '!! present in response !!' : 'absent')
  }
  // Tier must be one of the allowed values from the DB CHECK constraint.
  const validTiers = ['free', 'elite']
  if (user.tier !== undefined) {
    check(`${label}: user.tier is a valid value`, validTiers.includes(user.tier),
      validTiers.includes(user.tier) ? user.tier : `got "${user.tier}", expected one of ${validTiers.join(',')}`)
  }
}

async function postJson(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, body: json }
}

async function getJson(path, token) {
  const res = await fetch(BASE + path, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, body: json }
}

async function run() {
  // ── Test 1: /api/auth/login as Matt ────────────────────────────────
  // Matt's tier is 'elite' in the DB. If login response misses tier,
  // App.jsx will treat him as free and gate features. This test would
  // have caught the bug we just shipped today.
  console.log('TEST 1 — POST /api/auth/login (Matt, elite, admin)')
  // Need Matt's PIN to actually hit login. Use a JWT direct-mint instead
  // and hit /me as a proxy for "what does login return?" since they
  // share the helper. (We don't have the cleartext PIN.)
  const jwt = require('jsonwebtoken')
  if (!process.env.JWT_SECRET) {
    console.log('  ⚠ JWT_SECRET not set — pulling from Vercel...')
    require('child_process').execSync('vercel env pull --environment=production /tmp/.env.prod', { cwd: path.join(__dirname, '..') })
    loadEnv()
  }
  const mattToken = jwt.sign({ sub: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' })
  const me = await getJson('/api/auth/me', mattToken)
  check('  /me returned 200', me.status === 200, `got ${me.status}`)
  assertUserShape('  /me (Matt)', me.body?.user)
  if (me.body?.user) {
    check('  Matt is tier=elite', me.body.user.tier === 'elite', `got "${me.body.user.tier}"`)
    check('  Matt is role=admin', me.body.user.role === 'admin', `got "${me.body.user.role}"`)
    check('  Matt has onboarding_completed_at set', !!me.body.user.onboarding_completed_at,
      me.body.user.onboarding_completed_at ? 'set' : 'NULL — would force wizard')
  }

  console.log()

  // ── Test 2: /api/auth/signup as a throwaway user ───────────────────
  console.log('TEST 2 — POST /api/auth/signup (throwaway test user)')
  const ts = Date.now()
  const throwawayEmail = `smoketest-${ts}@example.com`
  const signup = await postJson('/api/auth/signup', {
    email: throwawayEmail, name: 'Smoke Test', pin: '4242',
  })
  check('  /signup returned 201', signup.status === 201, `got ${signup.status}`)
  assertUserShape('  /signup (new user)', signup.body?.user)
  if (signup.body?.user) {
    check('  new user defaults to tier=free', signup.body.user.tier === 'free', `got "${signup.body.user.tier}"`)
    check('  new user has onboarding_completed_at = null', signup.body.user.onboarding_completed_at == null,
      signup.body.user.onboarding_completed_at == null ? 'null (correct)' : `set to ${signup.body.user.onboarding_completed_at} — wizard would NOT show`)
    check('  /signup returned a token', !!signup.body.token, signup.body.token ? 'JWT present' : 'MISSING — login impossible')

    // Also exercise /me with the signup-issued token to verify token works.
    const meAfterSignup = await getJson('/api/auth/me', signup.body.token)
    check('  /me works with signup-issued token', meAfterSignup.status === 200, `got ${meAfterSignup.status}`)
    assertUserShape('  /me (after signup)', meAfterSignup.body?.user)
  }

  // Cleanup — drop the throwaway user
  if (signup.body?.user?.id) {
    try {
      const { Pool } = require('pg')
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
      await pool.query('DELETE FROM tm_users WHERE id = $1', [signup.body.user.id])
      await pool.end()
      console.log(`  ✓ cleaned up test user ${signup.body.user.id}`)
    } catch (e) {
      console.log(`  ⚠ cleanup failed: ${e.message}`)
    }
  }

  console.log()

  // ── Test 3: /api/auth/login with bad PIN — should 401 ──────────────
  console.log('TEST 3 — POST /api/auth/login with wrong PIN (security check)')
  // First create another throwaway with a known PIN, then try wrong PIN
  const ts2 = Date.now()
  const t2email = `smoketest-${ts2}-bad@example.com`
  const tCreate = await postJson('/api/auth/signup', { email: t2email, name: 'Bad PIN Test', pin: '1234' })
  if (tCreate.status === 201) {
    const wrong = await postJson('/api/auth/login', { email: t2email, pin: '9999' })
    check('  wrong PIN returns 401', wrong.status === 401, `got ${wrong.status}`)
    check('  wrong PIN does NOT leak user info', !wrong.body?.user, wrong.body?.user ? '!! user leaked !!' : 'no user in body')

    // And good PIN should work
    const right = await postJson('/api/auth/login', { email: t2email, pin: '1234' })
    check('  correct PIN returns 200', right.status === 200, `got ${right.status}`)
    assertUserShape('  /login (correct PIN)', right.body?.user)
    check('  /login response includes token', !!right.body?.token, right.body?.token ? 'JWT present' : 'MISSING')

    // Cleanup
    try {
      const { Pool } = require('pg')
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
      await pool.query('DELETE FROM tm_users WHERE id = $1', [tCreate.body.user.id])
      await pool.end()
      console.log(`  ✓ cleaned up test user ${tCreate.body.user.id}`)
    } catch {}
  } else {
    check('  Test 3 setup (create throwaway with known PIN)', false, `signup status=${tCreate.status}`)
  }

  console.log()

  // ── Test 4: /api/auth/me without token — should 401 ────────────────
  console.log('TEST 4 — GET /api/auth/me without token')
  const noAuth = await getJson('/api/auth/me')
  check('  no-token returns 401', noAuth.status === 401, `got ${noAuth.status}`)

  console.log()

  // ── Test 5: /api/auth/me with bad token — should 401 ───────────────
  console.log('TEST 5 — GET /api/auth/me with garbage token')
  const badAuth = await getJson('/api/auth/me', 'garbage.jwt.token')
  check('  bad-token returns 401', badAuth.status === 401, `got ${badAuth.status}`)

  console.log()
  console.log('───────────────────────────────────────────')
  if (failures === 0) {
    console.log('✓ ALL CHECKS PASSED')
    console.log('───────────────────────────────────────────\n')
    process.exit(0)
  } else {
    console.log(`✗ ${failures} CHECK(S) FAILED`)
    console.log('───────────────────────────────────────────\n')
    process.exit(1)
  }
}

run().catch(e => {
  console.error('\n✗ FATAL:', e.message)
  console.error(e.stack)
  process.exit(2)
})
