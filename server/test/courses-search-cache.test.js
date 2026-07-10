// 2026-07-10 — route-level coverage for the course-vendor cache (migration
// 045). The regression this locks down: the vendor 429'd (rate limit) and
// /api/courses/search silently returned 200 {courses:[]} — search looked
// dead app-wide. Contract now: fresh cache → no vendor call; vendor OK →
// mapped + cached; vendor error + stale cache → stale served; vendor error +
// no cache → HONEST 502 (never a silent empty 200).
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)
const db = require_('../src/db.js')

let cacheRow = null          // what db.one returns for the search-cache lookup
const cacheWrites = []       // recorded INSERT ... tm_course_search_cache calls
let vendorResponse = null    // { ok, status, body } | 'unreachable'
let vendorCalls = 0

db.one = async (sql) => {
  if (/tm_users/.test(sql)) return { id: 42 }              // requireAuth
  if (/tm_course_search_cache/.test(sql)) return cacheRow  // cache lookup
  return null
}
db.query = async (sql, params) => {
  if (/INSERT INTO tm_course_search_cache/.test(sql)) cacheWrites.push({ sql, params })
  return { rows: [] }
}
db.many = async () => []

// Vendor stub — selective: golfcourseapi URLs are stubbed, everything else
// (the test's own request to the local express server) uses the real fetch.
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('golfcourseapi')) {
    vendorCalls++
    if (vendorResponse === 'unreachable') throw new Error('network down')
    return {
      ok: vendorResponse.ok,
      status: vendorResponse.status,
      json: async () => vendorResponse.body,
    }
  }
  return realFetch(url, opts)
}

process.env.JWT_SECRET = 'test-secret'
const TOKEN = jwt.sign({ sub: 42 }, 'test-secret')

async function search(params) {
  const router = require_('../src/routes/courses.js')
  const app = express()
  app.use('/api/courses', router)
  const server = app.listen(0)
  const port = server.address().port
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/api/courses/search?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  } finally {
    server.close()
  }
}

const VENDOR_COURSE = {
  id: 5001, club_name: 'Bayonne Gc', course_name: 'Bayonne Gc',
  location: { city: 'Bayonne', state: 'NJ', country: 'USA', latitude: 40.66, longitude: -74.11 },
}

describe('GET /api/courses/search — vendor cache (045)', () => {
  beforeEach(() => { cacheRow = null; cacheWrites.length = 0; vendorResponse = null; vendorCalls = 0 })

  it('vendor OK → 200 mapped (name expanded) + cache written', async () => {
    vendorResponse = { ok: true, status: 200, body: { courses: [VENDOR_COURSE] } }
    const r = await search('q=bayonne')
    expect(r.status).toBe(200)
    expect(r.json.courses).toHaveLength(1)
    expect(r.json.courses[0].club_name).toBe('Bayonne Golf Club') // Gc expanded
    expect(cacheWrites).toHaveLength(1)
    expect(cacheWrites[0].params[0]).toBe('bayonne') // normalized key
  })

  it('vendor 429 + NO cache → honest 502, never a silent empty 200', async () => {
    vendorResponse = { ok: false, status: 429, body: { error: 'rate limit exceeded' } }
    const r = await search('q=bayonne')
    expect(r.status).toBe(502)
    expect(r.json.error).toMatch(/briefly unavailable/)
  })

  it('vendor 429 + STALE cache → stale served (200)', async () => {
    vendorResponse = { ok: false, status: 429, body: { error: 'rate limit exceeded' } }
    cacheRow = {
      payload: [{ id: 5001, club_name: 'Bayonne Golf Club', latitude: 40.66, longitude: -74.11 }],
      fetched_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), // stale (>7d)
    }
    const r = await search('q=bayonne')
    expect(r.status).toBe(200)
    expect(r.json.courses[0].club_name).toBe('Bayonne Golf Club')
    expect(vendorCalls).toBe(1) // it did try the vendor first (cache was stale)
  })

  it('FRESH cache → served without any vendor call', async () => {
    cacheRow = {
      payload: [{ id: 5001, club_name: 'Bayonne Golf Club', latitude: 40.66, longitude: -74.11 }],
      fetched_at: new Date().toISOString(),
    }
    const r = await search('q=bayonne')
    expect(r.status).toBe(200)
    expect(r.json.courses).toHaveLength(1)
    expect(vendorCalls).toBe(0)
  })

  it('distance decorates + sorts AFTER the cache (location never cached)', async () => {
    cacheRow = {
      payload: [
        { id: 1, club_name: 'Far Club', latitude: 41.5, longitude: -75.0 },
        { id: 2, club_name: 'Near Club', latitude: 40.661, longitude: -74.111 },
      ],
      fetched_at: new Date().toISOString(),
    }
    const r = await search('q=club&lat=40.66&lng=-74.11')
    expect(r.status).toBe(200)
    expect(r.json.courses[0].club_name).toBe('Near Club')
    expect(r.json.courses[0].distance_km).toBeLessThan(1)
    expect(r.json.courses[1].distance_km).toBeGreaterThan(50)
  })

  it('vendor shape change (no courses array) is an error, not empty results', async () => {
    vendorResponse = { ok: true, status: 200, body: { unexpected: true } }
    const r = await search('q=bayonne')
    expect(r.status).toBe(502)
  })
})
