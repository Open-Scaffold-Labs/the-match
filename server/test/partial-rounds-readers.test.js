// Partial-rounds spec (2026-07-16) §7 — route-level coverage for the reader
// surfaces on the shared roundMath lib: GET /api/stats/summary, GET
// /api/profile (avg3), GET /api/rounds (D8 fields). friends.js uses the
// SAME lib + the same expressions (verified by the roundMath unit suite +
// lint); its route has a heavy relationship preamble not worth stubbing here.
// Harness: real router + real requireAuth, db singleton patched through
// Node's require registry (project convention — see rounds-shots-patch.test.js).
import { describe, it, expect } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)
const db = require_('../src/db.js')

const PARS18 = [4,4,3,5,4,4,3,5,4, 4,4,3,5,4,4,3,5,4] // 72
const PARS9  = [4,4,4,4,4,4,4,4,4]                     // 36

// Mixed corpus: 2 full 18s, one 12-hole partial (+6 → equiv 81), one 5-hole
// partial (display-only), one FULL 9-hole-course round (40 on par 36 → equiv 80).
const fullA     = { id: 1, total: 90, course_par: 72, scores: PARS18.map(p => p + 1), hole_pars: PARS18, date: '2026-07-15', course_name: 'A', game_type: 'stroke' }
const fullB     = { id: 2, total: 82, course_par: 72, scores: PARS18.map((p, i) => (i < 10 ? p + 1 : p)), hole_pars: PARS18, date: '2026-07-14', course_name: 'B', game_type: 'stroke' }
const partial12 = { id: 3, total: 53, course_par: 72, scores: PARS18.map((p, i) => (i < 6 ? p + 1 : i < 12 ? p : 0)), hole_pars: PARS18, date: '2026-07-13', course_name: 'C', game_type: 'stroke' }
const partial5  = { id: 4, total: 25, course_par: 72, scores: PARS18.map((p, i) => (i < 5 ? p + 1 : 0)), hole_pars: PARS18, date: '2026-07-12', course_name: 'D', game_type: 'stroke' }
const nineFull  = { id: 5, total: 40, course_par: 36, scores: PARS9.map((p, i) => (i < 4 ? p + 1 : p)), hole_pars: PARS9, date: '2026-07-11', course_name: 'E', game_type: 'stroke' }
const CORPUS = [fullA, fullB, partial12, partial5, nineFull]

// sanity on the fixture arithmetic itself
if (fullA.scores.reduce((s, x) => s + x, 0) !== 90) throw new Error('fixture fullA broken')
if (partial12.scores.reduce((s, x) => s + x, 0) !== 53) throw new Error('fixture partial12 broken')

process.env.JWT_SECRET = 'test-secret'
const TOKEN = jwt.sign({ sub: 42 }, 'test-secret')

db.one = async (sql) => {
  if (/tm_club_stats/.test(sql)) return { club_data: {} }
  if (/tm_user_seasons/.test(sql)) return null
  if (/tm_users/.test(sql)) return { id: 42, handicap: 12.3, name: 'T', sg_baseline: 'auto' }
  return null
}
db.many = async (sql) => {
  if (/tm_match_history/.test(sql)) return []
  if (/FROM tm_rounds/.test(sql)) {
    if (/date >=/.test(sql)) return CORPUS.map(r => ({ date: r.date })) // streak query
    return CORPUS
  }
  return []
}
db.query = async () => ({ rows: [] })

async function get(path, mount, routerFile) {
  const router = require_(routerFile)
  const app = express()
  app.use(express.json())
  app.use(mount, router)
  const server = app.listen(0)
  const port = server.address().port
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  } finally { server.close() }
}

describe('GET /api/stats/summary (partial-aware)', () => {
  it('avg = mean equiv18 over qualifying; best = full rounds only, real totals; sub-9 excluded', async () => {
    const r = await get('/api/stats/summary', '/api/stats', '../src/routes/stats.js')
    expect(r.status).toBe(200)
    // qualifying equiv18s: 90, 82, 81 (53 = +6 thru 12), 80 (40×2 on the 9-hole
    // course). partial5 excluded. mean = 333/4 = 83.25 → 83.3
    expect(r.json.avgScore).toBe(83.3)
    // best full round by REAL total: the 9-hole 40 — labeled via bestScoreHoles
    expect(r.json.bestScore).toBe(40)
    expect(r.json.bestScoreHoles).toBe(9)
    expect(r.json.roundCount).toBe(5)
  })
})

describe('GET /api/profile (avg3 partial-aware)', () => {
  it('avg3 = last 3 QUALIFYING rounds as equiv18 (partial5 skipped)', async () => {
    const r = await get('/api/profile', '/api/profile', '../src/routes/profile.js')
    expect(r.status).toBe(200)
    // last 3 qualifying by date order: fullA 90, fullB 82, partial12 81 → 84.3
    expect(r.json.avg3).toBe(84.3)
  })
})

describe('GET /api/rounds (D8 fields)', () => {
  it('ships holes_played / par_played / to_par_through / is_partial / equiv_18', async () => {
    const r = await get('/api/rounds?limit=10', '/api/rounds', '../src/routes/rounds.js')
    expect(r.status).toBe(200)
    const byId = Object.fromEntries(r.json.rounds.map(x => [x.id, x]))
    expect(byId[1]).toMatchObject({ holes_played: 18, is_partial: false, to_par_through: 18, equiv_18: 90 })
    expect(byId[3]).toMatchObject({ holes_played: 12, is_partial: true,  to_par_through: 6,  par_played: 47, equiv_18: 81 })
    expect(byId[4]).toMatchObject({ holes_played: 5,  is_partial: true,  to_par_through: 5 })
    expect(byId[5]).toMatchObject({ holes_played: 9,  is_partial: false, equiv_18: 80 })
  })
})
