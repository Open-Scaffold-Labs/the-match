// Centralized User row shape — every endpoint that returns a tm_users
// row to the client MUST select THESE columns and only these.
//
// Why this exists: on 2026-05-03 we shipped two production bugs in one
// session because /login and /signup had drifted from /me. Login was
// missing onboarding_completed_at (made every existing user re-see
// the wizard) and tier (blocked Matt — an `elite` admin — from
// leagues with a "free tier upgrade" wall). The DB had the right
// values; the response shape was wrong.
//
// The class of bug is "endpoints that return the same conceptual
// object but have hand-written SELECT lists that drift apart." The
// fix is a single source of truth for what columns make up the
// public User shape.
//
// Usage:
//   const { USER_PUBLIC_COLUMNS, USER_PUBLIC_COLUMNS_WITH_PIN_HASH,
//           sanitizeUser } = require('../lib/user')
//   const u = await db.one(`SELECT ${USER_PUBLIC_COLUMNS} FROM tm_users WHERE id = $1`, [id])
//   res.json({ user: u })
//
// For login (which needs pin_hash for bcrypt compare):
//   const u = await db.one(`SELECT ${USER_PUBLIC_COLUMNS_WITH_PIN_HASH} FROM tm_users WHERE email = $1`, [email])
//   const ok = await bcrypt.compare(pin, u.pin_hash)
//   res.json({ user: sanitizeUser(u) })
//
// Adding a new column? Update USER_PUBLIC_COLUMNS here AND verify any
// client code that reads it. Removing a column? Search for it in the
// client first; the response shape is a contract.
//
// (2026-05-03 — Matt: "this cant be happening to users")

// The public-facing User shape. id first, then identity, then role/
// tier (tier especially is feature-gating critical), then onboarding
// state (UI flow critical), then anything else.
const USER_PUBLIC_COLUMNS = [
  'id',
  'email',
  'name',
  'handle',
  'role',
  'tier',
  'elite_until',     // time-limited Elite from referrals/signup bonus
                     // (2026-05-07 PM3 — referral program v1).
                     // Effective Elite = tier === 'elite' || elite_until > NOW().
  'onboarding_completed_at',
  'onboarding_steps',
  'coach_marks_seen',
  'avatar',
  'cutout',          // PlayerCard background-removed photo (data URL)
  'handicap',
  'home_course',
  'bio',
  'gender',          // male|female|null — drives tee handling + defaults (migration 030)
  'sg_baseline',     // Strokes Gained baseline toggle: auto | tour | scratch |
                     // hcp-5..hcp-20 (migration 039, docs/SG-DESIGN.md).
  'shot_shape',      // Player tendencies for the AI caddie prompt (migration
  'typical_miss',    // 040): draw|fade|straight, left|right|both,
  'distance_miss',   // short|long|pin_high. All nullable = unknown.
].join(', ')

// Same as PUBLIC, plus pin_hash for the bcrypt compare in /login.
// Never return pin_hash to the client — pass the row through
// sanitizeUser() before res.json().
const USER_PUBLIC_COLUMNS_WITH_PIN_HASH = USER_PUBLIC_COLUMNS + ', pin_hash'

// Strip pin_hash (and any other server-only fields we add later) from
// a row before sending to the client.
function sanitizeUser(row) {
  if (!row) return row
  const { pin_hash, ...safe } = row
  return safe
}

// The list of fields the client is contractually guaranteed to find
// on a User. Used by the smoke-test to assert no field is dropped.
const REQUIRED_USER_FIELDS = [
  'id',
  'email',
  'name',
  'handle',
  'role',
  'tier',
  'onboarding_completed_at',
  'onboarding_steps',
  'coach_marks_seen',
]

module.exports = {
  USER_PUBLIC_COLUMNS,
  USER_PUBLIC_COLUMNS_WITH_PIN_HASH,
  sanitizeUser,
  REQUIRED_USER_FIELDS,
}
