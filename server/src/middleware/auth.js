const jwt = require('jsonwebtoken')
const db  = require('../db')
const { USER_PUBLIC_COLUMNS } = require('../lib/user')

// Sets req.user to the full public User shape (USER_PUBLIC_COLUMNS) so any
// downstream route handler can read req.user.tier, req.user.role,
// req.user.onboarding_completed_at, etc., without an extra DB lookup AND
// without the silent-undefined footgun where a narrow SELECT misses a
// field someone added later. (2026-05-03 — paired with the lib/user.js
// centralization that fixed the /signup + /login User-shape drift.)
module.exports = async function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = header.slice(7)
  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const user = await db.one(
    `SELECT ${USER_PUBLIC_COLUMNS} FROM tm_users WHERE id = $1`,
    [payload.sub]
  )
  if (!user) return res.status(401).json({ error: 'User not found' })

  req.user = user
  next()
}
