const jwt = require('jsonwebtoken')
const db  = require('../db')

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

  const user = await db.one('SELECT id, email, name, role, email_verified_at FROM tm_users WHERE id = $1', [payload.sub])
  if (!user) return res.status(401).json({ error: 'User not found' })

  // Defensive — only verify-issued tokens should reach here, but
  // an old (pre-migration) token or a manually-minted JWT for an
  // unverified user would otherwise sail through. (2026-05-02)
  if (!user.email_verified_at) {
    return res.status(403).json({ error: 'unverified', message: 'Please verify your email.' })
  }

  req.user = user
  next()
}
