// /api/clubs — user bag inventory CRUD.
//
// (2026-05-01 — Matt: My Bag rewrite)

const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

const VALID_SLOTS = new Set([
  'driver', '3w', '5w', '7w',
  'hybrid_1', 'hybrid_2',
  'iron_3', 'iron_4', 'iron_5', 'iron_6', 'iron_7', 'iron_8', 'iron_9',
  'pw', 'gw', 'sw', 'lw',
  'putter',
])

// GET /api/clubs/bag — every club the current user has saved.
router.get('/bag', async (req, res) => {
  try {
    const rows = await db.many(
      `SELECT id, slot, brand, model, avg_yards, position, updated_at
       FROM tm_user_clubs
       WHERE user_id = $1
       ORDER BY position ASC, slot ASC`,
      [req.user.id]
    )
    res.json({ clubs: rows })
  } catch (err) {
    console.error('[clubs/bag/get]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// PUT /api/clubs/bag/:slot — upsert a single slot.
// Body: { brand, model, avg_yards? }
router.put('/bag/:slot', async (req, res) => {
  try {
    const slot = String(req.params.slot || '')
    if (!VALID_SLOTS.has(slot)) return res.status(400).json({ error: 'Invalid slot' })
    const { brand, model, avg_yards } = req.body || {}
    if (!brand || !model) return res.status(400).json({ error: 'brand and model required' })

    // Distance required for everything except the putter (putter has
    // no meaningful "average distance"). Eagle Eye uses these values
    // to pick clubs for shots, so we don't accept null for swing slots.
    let yardsVal = null
    const distanceRequired = slot !== 'putter'
    if (avg_yards !== undefined && avg_yards !== null && avg_yards !== '') {
      const n = Number(avg_yards)
      if (!Number.isFinite(n) || n < 0 || n > 400) {
        return res.status(400).json({ error: 'avg_yards must be 0-400' })
      }
      yardsVal = Math.round(n)
    }
    if (distanceRequired && yardsVal == null) {
      return res.status(400).json({ error: 'avg_yards required for this slot' })
    }

    await db.query(
      `INSERT INTO tm_user_clubs (user_id, slot, brand, model, avg_yards)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, slot) DO UPDATE
         SET brand      = EXCLUDED.brand,
             model      = EXCLUDED.model,
             avg_yards  = EXCLUDED.avg_yards,
             updated_at = NOW()`,
      [req.user.id, slot, String(brand).trim(), String(model).trim(), yardsVal]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[clubs/bag/put]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// DELETE /api/clubs/bag/:slot — clear one slot.
router.delete('/bag/:slot', async (req, res) => {
  try {
    const slot = String(req.params.slot || '')
    if (!VALID_SLOTS.has(slot)) return res.status(400).json({ error: 'Invalid slot' })
    await db.query(
      `DELETE FROM tm_user_clubs WHERE user_id = $1 AND slot = $2`,
      [req.user.id, slot]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[clubs/bag/delete]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
