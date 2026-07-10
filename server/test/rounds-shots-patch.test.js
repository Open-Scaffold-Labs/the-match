// Phase 3 (2026-07-10) — route-level coverage for PATCH /api/rounds/:id/shots.
// Real router + REAL requireAuth (signed JWT); only the db layer is stubbed
// (project convention: pure logic in vitest, transactional behavior via the
// sandbox harness / live beta). Column existence (shots/putts/first_putts on
// tm_rounds) was verified against prod's information_schema when migration
// 044 was applied. What THIS test locks down: auth integration, body
// validation (400s), the owner-404 path, server-side re-cleaning (never
// trust editor output), and the atomic putts ride-along.
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createRequire } from 'module'

// The server is CommonJS. Load BOTH the db singleton and the router through
// Node's own require registry so they are the SAME instances (a vite-side ESM
// import would be a separate module graph — patching that copy does nothing,
// and vi.mock can't reach a native require chain either).
const require_ = createRequire(import.meta.url)
const db = require_('../src/db.js')

const updateCalls = []
let updateRow = { id: 1, shots: null, putts: null, first_putts: null }

// The db module is a CJS singleton — every route/middleware require() gets
// THIS object, so patching its methods here intercepts all of them (vi.mock
// can't reach into the server's CJS require chain).
db.one = async (sql, params) => {
  if (/tm_users/.test(sql)) return { id: 42 }             // requireAuth's user lookup
  updateCalls.push({ sql, params })                        // the PATCH's UPDATE
  return updateRow
}
db.many = async () => []
db.query = async () => ({ rows: [] })

process.env.JWT_SECRET = 'test-secret'
const TOKEN = jwt.sign({ sub: 42 }, 'test-secret')

async function makeApp() {
  const router = require_('../src/routes/rounds.js')
  const app = express()
  app.use(express.json())
  app.use('/api/rounds', router)
  return app
}

async function patchShots(app, id, body) {
  const server = app.listen(0)
  const port = server.address().port
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/rounds/${id}/shots`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  } finally {
    server.close()
  }
}

describe('PATCH /api/rounds/:id/shots', () => {
  beforeEach(() => { updateCalls.length = 0; updateRow = { id: 1, shots: null, putts: null, first_putts: null } })

  it('401s without a token (real requireAuth in the chain)', async () => {
    const app = await makeApp()
    const server = app.listen(0)
    const port = server.address().port
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/rounds/1/shots`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      expect(res.status).toBe(401)
    } finally { server.close() }
  })

  it('400s when shots is not an array', async () => {
    const app = await makeApp()
    for (const bad of [undefined, null, 'x', 42, {}]) {
      const r = await patchShots(app, 1, { shots: bad })
      expect(r.status).toBe(400)
    }
    expect(updateCalls.length).toBe(0) // never reached the UPDATE
  })

  it('re-cleans shots server-side (garbage dropped, valid kept, pin pos kept)', async () => {
    const app = await makeApp()
    const r = await patchShots(app, 1, {
      shots: [
        [{ lie: 'tee', toPin: 400.6, lat: 40.66, lon: -74.11 }, { lie: 'ocean', toPin: 10 }],
        null,
        [],
      ],
    })
    expect(r.status).toBe(200)
    const stored = JSON.parse(updateCalls[0].params[0])
    expect(stored[0]).toEqual([{ lie: 'tee', toPin: 401, lat: 40.66, lon: -74.11 }])
    expect(stored[1]).toBe(null)
    expect(stored[2]).toBe(null)
  })

  it('an all-garbage log stores SQL null (clearing is a legitimate edit)', async () => {
    const app = await makeApp()
    const r = await patchShots(app, 1, { shots: [[{ lie: 'x', toPin: 0 }], null] })
    expect(r.status).toBe(200)
    expect(updateCalls[0].params[0]).toBe(null)
  })

  it('owner check rides the WHERE clause; no row → 404', async () => {
    const app = await makeApp()
    updateRow = null // UPDATE matches nothing (wrong id OR not your round)
    const r = await patchShots(app, 999, { shots: [[{ lie: 'tee', toPin: 300 }]] })
    expect(r.status).toBe(404)
    const call = updateCalls[0]
    expect(call.params[call.params.length - 1]).toBe(42) // user id is the LAST param
    expect(call.sql).toMatch(/user_id = \$\d+/)
  })

  it('atomic putts ride-along: valid putts + firstPutts land in ONE UPDATE', async () => {
    const app = await makeApp()
    const r = await patchShots(app, 1, {
      shots: [[{ lie: 'tee', toPin: 300 }]],
      putts: [2, null, 1],
      firstPutts: ['3-10', null, 'in3'],
    })
    expect(r.status).toBe(200)
    expect(updateCalls.length).toBe(1)
    const { sql, params } = updateCalls[0]
    expect(sql).toMatch(/putts = \$2/)
    expect(sql).toMatch(/first_putts = \$3/)
    expect(JSON.parse(params[1])).toEqual([2, null, 1])
    expect(JSON.parse(params[2])).toEqual(['3-10', null, 'in3'])
  })

  it('invalid putts (when provided) → 400, nothing written', async () => {
    const app = await makeApp()
    const r = await patchShots(app, 1, { shots: [[{ lie: 'tee', toPin: 300 }]], putts: [9] })
    expect(r.status).toBe(400)
    expect(updateCalls.length).toBe(0)
  })

  it('mismatched firstPutts length degrades to all-null (putts PATCH parity)', async () => {
    const app = await makeApp()
    const r = await patchShots(app, 1, {
      shots: [[{ lie: 'tee', toPin: 300 }]],
      putts: [2, 1],
      firstPutts: ['3-10'],
    })
    expect(r.status).toBe(200)
    expect(JSON.parse(updateCalls[0].params[2])).toEqual([null, null])
  })
})
