// shot-capture.js — one durable per-hole shot buffer, shared by Eagle Eye
// "walk-and-confirm" capture (Slice 1+) and the manual "+ Log Shot" sheet.
// (2026-07-07, Slice 0)
//
// A "descriptor" is the identity + hole contract every caller passes:
//   { scope, uid, holeIdx }
//     scope   = `outing:<CODE>` (an outing, code upper-cased) | 'solo'
//     uid     = user id — per-user scoping (mirrors solo-round.js; two
//               accounts on one device must not collide)
//     holeIdx = 0-BASED hole index (matches the scores/shots arrays and the
//               server's setShotsAtHole; Eagle Eye converts currentHole-1)
//
// A stored shot is { lie, toPin, club? } — exactly what the server's
// cleanHoleShots keeps and what the SG engine reads (lie + toPin). This
// buffer is shape-preserving and does NOT clean; server-side cleaning still
// runs on write, and the SG engine independently gates on complete chains.
//
// Storage:
//   • outing scope → localStorage key `tm-shots-v1:outing:<CODE>:<uid>:<hIdx>`
//   • solo scope   → delegated to solo-round.js's readSoloShots/writeSoloShots
//     so solo keeps exactly ONE physical store (ActiveRound's round blob),
//     never a second copy that could race with ActiveRound's autosave.
//
// Every localStorage access is guarded: a disabled / quota'd / private-mode
// store degrades to "not logged" ([] / no-op), never a thrown error — capture
// can never break a score write. (Same discipline as solo-round.js / App.jsx.)

import { readSoloShots, writeSoloShots } from './solo-round.js'

const PREFIX = 'tm-shots-v1'

const isSolo = (scope) => scope === 'solo'

const validHoleIdx = (holeIdx) => {
  const h = Number(holeIdx)
  return Number.isInteger(h) && h >= 0
}

// Pure — the localStorage key for an OUTING descriptor. Upper-cases the
// outing code so a writer and reader can't diverge on case (Risk R15). Solo
// does not use this (it delegates to the blob); exported for tests + clarity.
export function scopeKey({ scope, uid, holeIdx } = {}) {
  const s = typeof scope === 'string' ? scope : ''
  const norm = s.startsWith('outing:') ? `outing:${s.slice(7).toUpperCase()}` : s
  return `${PREFIX}:${norm}:${uid ?? 'anon'}:${Number(holeIdx)}`
}

// Read one hole's buffered shots → array (never null; [] on miss/corrupt/disabled).
export function readHoleBuffer(descriptor = {}) {
  const { scope, uid, holeIdx } = descriptor
  if (!validHoleIdx(holeIdx)) return []
  if (isSolo(scope)) return readSoloShots(uid, Number(holeIdx))
  try {
    const raw = localStorage.getItem(scopeKey(descriptor))
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// Replace one hole's buffer with `arr`. Returns the stored array.
export function writeHoleBuffer(descriptor = {}, arr = []) {
  const { scope, uid, holeIdx } = descriptor
  const next = Array.isArray(arr) ? arr : []
  if (!validHoleIdx(holeIdx)) return next
  if (isSolo(scope)) return writeSoloShots(uid, Number(holeIdx), next)
  try {
    localStorage.setItem(scopeKey(descriptor), JSON.stringify(next))
  } catch {
    /* disabled / quota — degrade to not-logged, never throw */
  }
  return next
}

// Append one shot → returns the NEW full array for the hole. A null/undefined
// shot is a no-op read (never writes a junk entry).
export function appendShot(descriptor = {}, shot) {
  const current = readHoleBuffer(descriptor)
  if (shot == null) return current
  return writeHoleBuffer(descriptor, [...current, shot])
}

// Clear one hole's buffer.
export function clearHoleBuffer(descriptor = {}) {
  const { scope, uid, holeIdx } = descriptor
  if (!validHoleIdx(holeIdx)) return
  if (isSolo(scope)) { writeSoloShots(uid, Number(holeIdx), []); return }
  try {
    localStorage.removeItem(scopeKey(descriptor))
  } catch {
    /* ignore */
  }
}
