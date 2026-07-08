// Unit tests for shot-capture.js — the shared per-hole shot buffer (Slice 0).
// Run: node client/src/lib/__tests__/shot-capture.test.mjs
import assert from 'node:assert/strict'
import { scopeKey, readHoleBuffer, writeHoleBuffer, appendShot, clearHoleBuffer } from '../shot-capture.js'
import { SOLO_ROUND_STORAGE_KEY } from '../solo-round.js'

// Minimal in-memory localStorage for Node (no DOM). The buffer modules don't
// touch storage at import time, so setting it here (after the hoisted imports)
// is in time for every function call below.
class MemStore {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear() }
}
globalThis.localStorage = new MemStore()

let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }
const eq = (n, a, b) => { assert.deepEqual(a, b, n); console.log('  ✓ ' + n); pass++ }

// ── scopeKey: distinguishes every axis + upper-cases the outing code ──────
eq('scopeKey builds the outing key (code upper-cased)',
  scopeKey({ scope: 'outing:abcd', uid: 7, holeIdx: 3 }),
  'tm-shots-v1:outing:ABCD:7:3')
ok('scopeKey distinguishes holeIdx',
  scopeKey({ scope: 'outing:AB', uid: 7, holeIdx: 0 }) !== scopeKey({ scope: 'outing:AB', uid: 7, holeIdx: 1 }))
ok('scopeKey distinguishes uid',
  scopeKey({ scope: 'outing:AB', uid: 7, holeIdx: 0 }) !== scopeKey({ scope: 'outing:AB', uid: 8, holeIdx: 0 }))
ok('scopeKey distinguishes outing code',
  scopeKey({ scope: 'outing:AB', uid: 7, holeIdx: 0 }) !== scopeKey({ scope: 'outing:CD', uid: 7, holeIdx: 0 }))

// ── outing scope: read / append / write / clear ──────────────────────────
const out = { scope: 'outing:XYZ', uid: 42, holeIdx: 2 }
eq('empty hole → []', readHoleBuffer(out), [])
appendShot(out, { lie: 'tee', toPin: 410, club: 'Dr' })
appendShot(out, { lie: 'fairway', toPin: 150, club: '8i' })
eq('appendShot accumulates the full array', readHoleBuffer(out),
  [{ lie: 'tee', toPin: 410, club: 'Dr' }, { lie: 'fairway', toPin: 150, club: '8i' }])
ok('appendShot returns the NEW full array', appendShot(out, { lie: 'rough', toPin: 20 }).length === 3)
ok('null shot is a no-op (no junk entry)', appendShot(out, null).length === 3)
eq('a different hole is independent', readHoleBuffer({ ...out, holeIdx: 5 }), [])
writeHoleBuffer(out, [{ lie: 'sand', toPin: 30 }])
eq('writeHoleBuffer replaces the whole hole', readHoleBuffer(out), [{ lie: 'sand', toPin: 30 }])
clearHoleBuffer(out)
eq('clearHoleBuffer empties the hole', readHoleBuffer(out), [])
eq('negative holeIdx → []', readHoleBuffer({ scope: 'outing:XYZ', uid: 42, holeIdx: -1 }), [])

// corrupt JSON → [] (never throws)
globalThis.localStorage.setItem(scopeKey(out), 'not-json{')
eq('corrupt JSON → []', readHoleBuffer(out), [])
clearHoleBuffer(out)

// ── disabled / throwing storage → [] / no-throw ──────────────────────────
const good = globalThis.localStorage
globalThis.localStorage = {
  getItem() { throw new Error('disabled') },
  setItem() { throw new Error('disabled') },
  removeItem() { throw new Error('disabled') },
}
eq('throwing storage → readHoleBuffer []', readHoleBuffer(out), [])
ok('throwing storage → appendShot does not throw',
  (() => { appendShot(out, { lie: 'tee', toPin: 1 }); return true })())
globalThis.localStorage = good

// ── solo scope: façade round-trips through the blob, preserving other keys ─
const uid = 99
const blob = {
  phase: 'scoring',
  config: { pars: [4, 4, 4] },
  hole: 1,
  scores: [4, 0, 0],
  shots: [[{ lie: 'tee', toPin: 400 }], [], []],
  putts: [2, null, null],
  firstPutts: ['3-10', null, null],
}
globalThis.localStorage.setItem(SOLO_ROUND_STORAGE_KEY(uid), JSON.stringify(blob))
const solo = { scope: 'solo', uid, holeIdx: 1 }
eq('solo empty hole → []', readHoleBuffer(solo), [])
appendShot(solo, { lie: 'fairway', toPin: 120, club: 'PW' })
eq('solo append lands in the blob', readHoleBuffer(solo), [{ lie: 'fairway', toPin: 120, club: 'PW' }])
const after = JSON.parse(globalThis.localStorage.getItem(SOLO_ROUND_STORAGE_KEY(uid)))
eq('solo façade preserves OTHER holes', after.shots[0], [{ lie: 'tee', toPin: 400 }])
eq('solo façade preserves scores/putts/config',
  { scores: after.scores, putts: after.putts, pars: after.config.pars },
  { scores: [4, 0, 0], putts: [2, null, null], pars: [4, 4, 4] })
ok('solo write with NO round is a no-op (returns arr, stores nothing)',
  (() => {
    const r = appendShot({ scope: 'solo', uid: 12345, holeIdx: 0 }, { lie: 'tee', toPin: 1 })
    return r.length === 1 && globalThis.localStorage.getItem(SOLO_ROUND_STORAGE_KEY(12345)) === null
  })())

console.log(`\nALL ${pass} SHOT-CAPTURE ASSERTIONS PASSED`)
