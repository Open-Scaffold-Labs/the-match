const router    = require('express').Router()
const rateLimit = require('express-rate-limit')
const bcrypt    = require('bcryptjs')
const jwt       = require('jsonwebtoken')
const db        = require('../db')

function mintToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '90d' })
}

// 5 login/signup attempts per IP per minute. Real burst protection against
// brute-forcing the 4-digit PIN (10,000 combinations is otherwise feasible
// to enumerate in hours). Vercel serverless functions reset state per cold
// start, so this is in-memory phase-1 protection — phase 2 (later) should
// move to a Postgres-backed or Redis-backed store. Audit B5 / 2026-04-29.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a minute.' },
})

// POST /api/auth/signup
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, name, pin } = req.body
    if (!email || !name || !pin) return res.status(400).json({ error: 'email, name, and pin required' })
    if (!/^\d{4}$/.test(pin))   return res.status(400).json({ error: 'PIN must be 4 digits' })

    // db.one returns null when no row — safe to use as existence check
    const exists = await db.one('SELECT id FROM tm_users WHERE email = $1', [email.toLowerCase()])
    if (exists) return res.status(409).json({ error: 'Email already registered' })

    const hash = await bcrypt.hash(pin, 10)
    const user = await db.one(
      `INSERT INTO tm_users (email, name, pin_hash) VALUES ($1, $2, $3)
       RETURNING id, email, name, role`,
      [email.toLowerCase(), name.trim(), hash]
    )
    res.status(201).json({ token: mintToken(user.id), user })
  } catch (err) {
    console.error('[signup]', err.message)
    res.status(500).json({ error: 'Signup failed. Please try again.' })
  }
})

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, pin } = req.body
    if (!email || !pin) return res.status(400).json({ error: 'email and pin required' })

    const user = await db.one(
      'SELECT id, email, name, role, pin_hash FROM tm_users WHERE email = $1',
      [email.toLowerCase()]
    )
    if (!user) return res.status(401).json({ error: 'Invalid email or PIN' })

    const ok = await bcrypt.compare(pin, user.pin_hash)
    if (!ok)  return res.status(401).json({ error: 'Invalid email or PIN' })

    const { pin_hash: _, ...safeUser } = user
    res.json({ token: mintToken(user.id), user: safeUser })
  } catch (err) {
    console.error('[login]', err.message)
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
})

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { sub } = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    const user = await db.one('SELECT id, email, name, role FROM tm_users WHERE id = $1', [sub])
    if (!user) return res.status(401).json({ error: 'Not found' })
    res.json({ user })
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
})

module.exports = router
