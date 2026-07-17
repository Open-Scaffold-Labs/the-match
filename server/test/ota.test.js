// 2026-07-16 — route-level coverage for the self-hosted OTA endpoint
// (migration 049, routes/ota.js). Locks the Capgo plugin wire contract:
// the device POSTs AppInfos; we answer {version,url,checksum} ONLY when an
// active, native-compatible, strictly-newer bundle exists — every other
// path (including server errors) answers a benign {message} with HTTP 200.
// The regression class this prevents: a malformed/errored update response
// bricking or looping devices. Fail safe = device keeps what it runs.
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)
const db = require_('../src/db.js')

let activeBundle = null   // what db.one returns for the active-bundle lookup
let oneShouldThrow = false
const statInserts = []
let statShouldThrow = false

db.one = async () => {
  if (oneShouldThrow) throw new Error('db down')
  return activeBundle
}
db.query = async (sql, params) => {
  if (/tm_ota_stats/.test(sql)) {
    if (statShouldThrow) throw new Error('stats db down')
    statInserts.push(params)
    return { rows: [] }
  }
  return { rows: [] }
}

const ota = require_('../src/routes/ota.js')
const app = express()
app.use(express.json())
app.use('/api/ota', ota)

function post(path, body) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await r.json()
        resolve({ status: r.status, json })
      } catch (e) { reject(e) } finally { srv.close() }
    })
  })
}

const DEVICE = {
  platform: 'ios',
  device_id: 'test-device',
  app_id: 'com.openscaffoldlabs.thematch',
  plugin_version: '8.51.1',
  version_build: '1.0.0',   // native binary version
  version_code: '1',
  version_name: 'builtin',  // fresh install: running the shipped bundle
  version_os: '26.0',
  is_emulator: true,
  is_prod: false,
}

beforeEach(() => {
  activeBundle = null
  oneShouldThrow = false
  statShouldThrow = false
  statInserts.length = 0
})

describe('POST /api/ota/updates — update served', () => {
  it('serves {version,url,checksum} when active bundle is newer and native-compatible', async () => {
    activeBundle = { version: '1.0.1', url: 'https://x/b.zip', checksum: 'abc', min_native_version: '1.0.0' }
    const { status, json } = await post('/api/ota/updates', DEVICE)
    expect(status).toBe(200)
    expect(json).toEqual({ version: '1.0.1', url: 'https://x/b.zip', checksum: 'abc' })
  })

  it('"builtin" version_name compares against version_build (fresh install)', async () => {
    activeBundle = { version: '1.0.1', url: 'https://x/b.zip', checksum: 'abc', min_native_version: '1.0.0' }
    const { json } = await post('/api/ota/updates', { ...DEVICE, version_build: '1.0.1', version_name: 'builtin' })
    expect(json.message).toBe('up to date') // device build already 1.0.1
  })

  it('device already on the OTA bundle version → up to date', async () => {
    activeBundle = { version: '1.0.1', url: 'https://x/b.zip', checksum: 'abc', min_native_version: '1.0.0' }
    const { json } = await post('/api/ota/updates', { ...DEVICE, version_name: '1.0.1' })
    expect(json.message).toBe('up to date')
  })

  it('device on a NEWER bundle than active (post-rollback) → no downgrade payload', async () => {
    activeBundle = { version: '1.0.1', url: 'https://x/b.zip', checksum: 'abc', min_native_version: '1.0.0' }
    const { json } = await post('/api/ota/updates', { ...DEVICE, version_name: '1.0.2' })
    expect(json.message).toBe('up to date')
    expect(json.url).toBeUndefined()
  })
})

describe('POST /api/ota/updates — gates (fail safe)', () => {
  it('foreign app_id → benign message, no bundle leak', async () => {
    activeBundle = { version: '9.9.9', url: 'https://x/b.zip', checksum: 'abc', min_native_version: '0.0.1' }
    const { status, json } = await post('/api/ota/updates', { ...DEVICE, app_id: 'com.evil.other' })
    expect(status).toBe(200)
    expect(json.message).toBe('unknown app_id')
    expect(json.url).toBeUndefined()
  })

  it('native-compatibility gate: binary older than min_native_version → no update', async () => {
    activeBundle = { version: '2.0.0', url: 'https://x/b.zip', checksum: 'abc', min_native_version: '1.1.0' }
    const { json } = await post('/api/ota/updates', { ...DEVICE, version_build: '1.0.0' })
    expect(json.message).toBe('native version below bundle minimum')
    expect(json.url).toBeUndefined()
  })

  it('no active bundle → benign message', async () => {
    const { json } = await post('/api/ota/updates', DEVICE)
    expect(json.message).toBe('no active bundle')
  })

  it('garbage device version → not comparable, no update (never guess)', async () => {
    activeBundle = { version: '1.0.1', url: 'https://x/b.zip', checksum: 'abc', min_native_version: '1.0.0' }
    const { json } = await post('/api/ota/updates', { ...DEVICE, version_name: 'what-is-this' })
    expect(json.message).toBe('version not comparable')
  })

  it('malformed body (no fields) → benign message, HTTP 200', async () => {
    const { status, json } = await post('/api/ota/updates', {})
    expect(status).toBe(200)
    expect(json.message).toBeDefined()
    expect(json.url).toBeUndefined()
  })

  it('db throws → fail SAFE: 200 {message}, never 500', async () => {
    oneShouldThrow = true
    const { status, json } = await post('/api/ota/updates', DEVICE)
    expect(status).toBe(200)
    expect(json.message).toBe('update check unavailable')
  })
})

describe('POST /api/ota/stats', () => {
  it('inserts a row and 200s', async () => {
    const { status, json } = await post('/api/ota/stats', {
      app_id: DEVICE.app_id, device_id: 'd1', platform: 'ios',
      action: 'set', version_name: '1.0.1', old_version_name: 'builtin',
    })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(statInserts.length).toBe(1)
    expect(statInserts[0][3]).toBe('set')
  })

  it('stats db failure is swallowed — still 200 (stats can never hurt devices)', async () => {
    statShouldThrow = true
    const { status, json } = await post('/api/ota/stats', { action: 'set' })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
  })
})

describe('semver comparator', () => {
  const cmp = ota._compareSemver
  it('orders correctly', () => {
    expect(cmp('1.0.1', '1.0.0')).toBe(1)
    expect(cmp('1.0.0', '1.0.1')).toBe(-1)
    expect(cmp('1.0.0', '1.0.0')).toBe(0)
    expect(cmp('2.0.0', '1.9.9')).toBe(1)
    expect(cmp('v1.2.3', '1.2.3')).toBe(0)      // tolerant of leading v
    expect(cmp('1.2.3-beta', '1.2.3')).toBe(0)  // suffix ignored (numeric compare)
  })
  it('returns null on garbage (callers treat as do-not-update)', () => {
    expect(cmp('builtin', '1.0.0')).toBe(null)
    expect(cmp('', '1.0.0')).toBe(null)
    expect(cmp('1.2', '1.0.0')).toBe(null)
  })
})
