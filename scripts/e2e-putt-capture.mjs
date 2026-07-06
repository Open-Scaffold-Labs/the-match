// Live e2e for outing putt capture (2026-07-06 spec) — runs against the
// REAL beta + prod DB using the dedicated test accounts (Test User #2,
// Demo Tester #14). Mints short-lived JWTs from JWT_SECRET in the local
// .env (never printed). Creates a clearly-labeled test outing, walks the
// full lifecycle, and prints PASS/FAIL per assertion.
//
//   node scripts/e2e-putt-capture.mjs
//
import { readFileSync } from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const jwt = require('jsonwebtoken') // hoisted to root node_modules (workspaces)

const BASE = 'https://the-match-roan.vercel.app/api/v1'
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const SECRET = env.match(/^JWT_SECRET=["']?([^"'\n]+)/m)[1]
const tok = id => jwt.sign({ sub: id }, SECRET, { expiresIn: '30m' })
const A = tok(2)   // Test User — host
const B = tok(14)  // Demo Tester

let pass = 0, fail = 0
const ok = (cond, label) => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + '  ' + label) }

async function call(token, method, path, body, headers = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  let j = null
  try { j = await r.json() } catch { /* non-JSON */ }
  return { status: r.status, body: j }
}

const main = async () => {
  // 1. Host creates a test outing (9 holes worth of scoring below)
  const create = await call(A, 'POST', '/outings', {
    name: 'E2E PUTT CAPTURE TEST (safe to delete)',
    courseName: 'E2E Test Course', coursePar: 72,
    scoringFormats: ['stroke'], expectedPlayers: 2,
  })
  ok(create.status === 200 || create.status === 201, `create outing (${create.status})`)
  const code = create.body?.outing?.code || create.body?.code
  ok(!!code, `outing code: ${code}`)
  if (!code) return

  // 2. B joins
  const join = await call(B, 'POST', `/outings/${code}/join`, {})
  ok(join.status === 200, `B joins (${join.status})`)

  // 3. A self-scores hole 0 WITH putts (self path)
  const s1 = await call(A, 'PUT', `/outings/${code}/scores`,
    { hole: 0, score: 5, putts: 2, firstPutt: '10-25' },
    { 'Idempotency-Key': crypto.randomUUID() })
  ok(s1.status === 200, `A self-score+putts hole 1 (${s1.status})`)

  // 4. A (host) scores B's hole WITH putt fields → must be IGNORED (writer≠target)
  const s2 = await call(A, 'PUT', `/outings/${code}/scores/host`,
    { hole: 0, score: 4, user_id: 14, putts: 1, firstPutt: 'in3' },
    { 'Idempotency-Key': crypto.randomUUID() })
  ok(s2.status === 200, `A scores B hole 1 w/ putt fields (${s2.status})`)

  // 5. A (host) scores THEMSELVES via the host endpoint (the routing wrinkle) with putts
  const s3 = await call(A, 'PUT', `/outings/${code}/scores/host`,
    { hole: 1, score: 4, user_id: 2, putts: 1, firstPutt: 'in3' },
    { 'Idempotency-Key': crypto.randomUUID() })
  ok(s3.status === 200, `A host-self-score+putts hole 2 (${s3.status})`)

  // 6. A re-scores hole 0 WITHOUT putt fields → earlier putts must SURVIVE
  const s4 = await call(A, 'PUT', `/outings/${code}/scores`,
    { hole: 0, score: 6 },
    { 'Idempotency-Key': crypto.randomUUID() })
  ok(s4.status === 200, `A score-correct hole 1 sans putts (${s4.status})`)

  // 7. Fill holes 3–9 for A (valid 9-hole round for fan-out); B gets 9 too
  for (let h = 2; h < 9; h++) {
    await call(A, 'PUT', `/outings/${code}/scores`, { hole: h, score: 4, putts: 2, firstPutt: '3-10' })
    await call(A, 'PUT', `/outings/${code}/scores/host`, { hole: h, score: 4, user_id: 14 })
  }
  // B needs holes 0-1 too (A already scored B hole 0; hole 1:)
  await call(A, 'PUT', `/outings/${code}/scores/host`, { hole: 1, score: 5, user_id: 14 })

  // 8. Invalid putts (count > score) must be dropped but score saved
  const s5 = await call(A, 'PUT', `/outings/${code}/scores`, { hole: 8, score: 3, putts: 5, firstPutt: 'in3' })
  ok(s5.status === 200, `invalid putts>score still saves score (${s5.status})`)

  // 9. End the match (host)
  const end = await call(A, 'POST', `/outings/${code}/end`, {})
  ok(end.status === 200, `end outing (${end.status})`)

  console.log('OUTING_CODE=' + code)
  console.log(`SUMMARY: ${pass} pass, ${fail} fail`)
}
main().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1) })
