// Public-facing user handles (e.g. @mlav). Mirror of the SQL backfill
// logic in migration 014, used at signup time so new users get a
// handle the same way existing users were backfilled.
//
// Algorithm:
//   1. Tokenize the user's name on whitespace.
//   2. Take first token (lowercased, alphanumerics only) and append
//      the first letter of the last token if there's more than one.
//   3. Empty-name fallback: use the email's local part, alphanumerics
//      only, capped at 12 chars.
//   4. Cap base at 16 chars (handle CHECK is 2-20).
//   5. Try base, then base2, base3, ... until DB confirms it's free.
//
// This module exports a single async function that takes a name +
// email + a `db` instance and returns a unique handle string.
//
// (2026-05-01 — Matt: handles for disambiguation + shareable
// identifiers without onboarding friction.)

function generateBase(name, email) {
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean)
  const stripAlnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

  let base = ''
  if (tokens.length > 0) {
    const first = stripAlnum(tokens[0])
    const last  = tokens.length > 1 ? stripAlnum(tokens[tokens.length - 1]) : ''
    base = first + (last ? last.slice(0, 1) : '')
  }

  // Empty-name fallback: email local part, capped at 12.
  if (!base) {
    const local = String(email || '').split('@')[0]
    base = stripAlnum(local).slice(0, 12)
  }

  // Cap to 16 chars to leave room for the dedup suffix.
  base = base.slice(0, 16)

  // Last-resort fallback when the algorithm produced nothing.
  if (base.length < 2) base = 'user'

  return base
}

// Iteratively probe the DB for a free handle. Worst case is N hits
// to the DB for an N-th-collision name — fine for signup volume.
// `db` is the pg-promise-style instance with `.one()` returning null
// when no row matches.
async function generateUniqueHandle(name, email, db) {
  const base = generateBase(name, email)
  let candidate = base
  let suffix = 1
  // Hard cap on retries — if we somehow can't find a free slot in
  // 200 tries, throw rather than spinning.
  while (suffix < 200) {
    const taken = await db.one('SELECT id FROM tm_users WHERE handle = $1', [candidate])
    if (!taken) return candidate
    suffix += 1
    candidate = `${base}${suffix}`
  }
  throw new Error(`Could not generate a unique handle for "${name}"`)
}

module.exports = { generateBase, generateUniqueHandle }
