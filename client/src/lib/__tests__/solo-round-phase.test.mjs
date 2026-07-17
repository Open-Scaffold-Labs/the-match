// Unit tests for the solo-round resume-phase semantics (end-ceremony spec
// 2026-07-16, D5) + the session-index guards the discard path relies on (D2).
// Run: node --test client/src/lib/__tests__/solo-round-phase.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Minimal in-memory localStorage for Node (same pattern as shot-capture tests).
class MemStore {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear() }
}
globalThis.localStorage = new MemStore()

const { SOLO_ROUND_STORAGE_KEY, readSavedSoloRound, hasSavedSoloRound, startSoloRound } =
  await import('../solo-round.js')
const { readSession, writeSession, clearSession } =
  await import('../active-round-session.js')

const UID = 7
const KEY = SOLO_ROUND_STORAGE_KEY(UID)
const baseBlob = phase => ({
  phase,
  config: { courseName: 'Test GC', pars: [4, 4, 3] },
  hole: 1,
  scores: [4, 0, 0],
  shots: [[], [], []],
  putts: [null, null, null],
  firstPutts: [null, null, null],
})

test('readSavedSoloRound restores a scoring-phase blob (existing behavior)', () => {
  localStorage.clear()
  localStorage.setItem(KEY, JSON.stringify(baseBlob('scoring')))
  const saved = readSavedSoloRound(UID)
  assert.ok(saved)
  assert.equal(saved.phase, 'scoring')
})

test('readSavedSoloRound restores a summary-phase blob (D5 — new)', () => {
  localStorage.clear()
  localStorage.setItem(KEY, JSON.stringify(baseBlob('summary')))
  const saved = readSavedSoloRound(UID)
  assert.ok(saved, 'summary phase must be restorable')
  assert.equal(saved.phase, 'summary')
})

test('readSavedSoloRound still rejects a setup-phase blob', () => {
  localStorage.clear()
  localStorage.setItem(KEY, JSON.stringify(baseBlob('setup')))
  assert.equal(readSavedSoloRound(UID), null)
})

test('readSavedSoloRound rejects corrupt JSON and missing pars', () => {
  localStorage.clear()
  localStorage.setItem(KEY, 'not-json{')
  assert.equal(readSavedSoloRound(UID), null)
  const noPars = baseBlob('summary')
  noPars.config = { courseName: 'X' }
  localStorage.setItem(KEY, JSON.stringify(noPars))
  assert.equal(readSavedSoloRound(UID), null)
})

test('hasSavedSoloRound surfaces a summary-phase round (resume cards)', () => {
  localStorage.clear()
  localStorage.setItem(KEY, JSON.stringify(baseBlob('summary')))
  assert.equal(hasSavedSoloRound(UID), true)
})

test('startSoloRound refuses to clobber an unsaved summary-phase round', () => {
  localStorage.clear()
  localStorage.setItem(KEY, JSON.stringify(baseBlob('summary')))
  const started = startSoloRound(UID, { courseName: 'New GC', pars: [4, 4, 4] })
  assert.equal(started, false, 'a summary-phase round must block a new start')
  assert.equal(readSavedSoloRound(UID).config.courseName, 'Test GC')
})

// ── session-index guards the solo discard path relies on (D2/R3) ──────────

test('clearSession without a code clears a solo session', () => {
  localStorage.clear()
  writeSession(UID, { kind: 'solo', courseName: 'Test GC', holeCount: 18 })
  clearSession(UID)
  assert.equal(readSession(UID), null)
})

test('clearSession with a mismatched code never clears a match session', () => {
  localStorage.clear()
  writeSession(UID, { kind: 'match', code: 'ABCD' })
  clearSession(UID, { code: 'ZZZZ' })
  const s = readSession(UID)
  assert.ok(s, 'match session must survive a mismatched-code clear')
  assert.equal(s.code, 'ABCD')
})

test('a solo blob and a match session coexist independently', () => {
  localStorage.clear()
  localStorage.setItem(KEY, JSON.stringify(baseBlob('summary')))
  writeSession(UID, { kind: 'match', code: 'ABCD' })
  // The discard path's guard: only a kind==='solo' session may be cleared.
  const s = readSession(UID)
  assert.equal(s.kind, 'match')
  // Simulate the ActiveRound guard: it reads kind before clearing.
  if (s?.kind === 'solo') clearSession(UID)
  assert.ok(readSession(UID), 'match session untouched by a solo discard')
})
