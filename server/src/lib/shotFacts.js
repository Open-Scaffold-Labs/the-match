// Self-entered per-shot facts for outings (live-shot-capture, 2026-07-07).
//
// Sibling of puttFacts.js. A hole's shot log is an array of shots the read-time
// Strokes Gained engine (lib/sg) walks into OTT/APP/ARG: each shot needs a
// { lie, toPin } (club is kept for display only). Like putts, these are:
//   • SELF-entered only (the PUT /:code/scores writer owns their own card),
//   • OPTIONAL-always — touched only when the score body carries a `shots`
//     key, so a plain score correction never wipes an earlier shot log, and
//   • fail-soft — invalid entries are DROPPED, never a 400, so shot capture
//     can never break a score write.
// The SG engine independently gates each hole on a COMPLETE chain
// (shots.length + putts === score, every shot a valid off-green lie + toPin),
// so partial or messy logs simply don't contribute — they never corrupt.

const VALID_LIES = new Set(['tee', 'fairway', 'rough', 'sand', 'recovery'])

// Clean ONE hole's shot array → [{ lie, toPin, club? }] or null when nothing
// usable. Keeps only shots carrying the { lie, toPin } the SG chain needs.
function cleanHoleShots(raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const lie = typeof s.lie === 'string' ? s.lie : null
    const toPin = Number(s.toPin)
    if (!VALID_LIES.has(lie) || !(toPin > 0)) continue
    const shot = { lie, toPin: Math.round(toPin) }
    if (typeof s.club === 'string' && s.club) shot.club = s.club
    out.push(shot)
  }
  return out.length ? out : null
}

// Set ONE hole's cleaned shots into the per-hole shots array (0-indexed hole,
// matching the scores array). Returns the array, or null when every hole is
// empty (so an all-empty log stores as SQL null, never []).
function setShotsAtHole(existing, hole, cleanedHoleShots) {
  const arr = Array.isArray(existing) ? existing.slice() : []
  const h = Number(hole)
  if (!Number.isInteger(h) || h < 0) return arr.some(x => x != null) ? arr : null
  while (arr.length <= h) arr.push(null)
  arr[h] = cleanedHoleShots // array or null
  return arr.some(x => x != null) ? arr : null
}

// Clean a WHOLE round's shots (array of per-hole shot arrays) — maps each hole
// through cleanHoleShots so the solo POST /api/rounds path gets the same
// server-side hygiene the outing PUT /:code/scores already applies at write
// time. Returns an array aligned to holes (each entry a cleaned array or null),
// or null when no hole has a usable shot. Fail-soft: never throws.
function cleanShotsForRound(rawShots) {
  if (!Array.isArray(rawShots)) return null
  const out = rawShots.map(hole => cleanHoleShots(hole))
  return out.some(x => x != null) ? out : null
}

module.exports = { cleanHoleShots, setShotsAtHole, cleanShotsForRound, VALID_LIES }
