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
      `SELECT id, slot, brand, model, position, updated_at
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
router.put('/bag/:slot', async (req, res) => {
  try {
    const slot = String(req.params.slot || '')
    if (!VALID_SLOTS.has(slot)) return res.status(400).json({ error: 'Invalid slot' })
    const { brand, model } = req.body || {}
    if (!brand || !model) return res.status(400).json({ error: 'brand and model required' })

    await db.query(
      `INSERT INTO tm_user_clubs (user_id, slot, brand, model)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, slot) DO UPDATE
         SET brand = EXCLUDED.brand,
             model = EXCLUDED.model,
             updated_at = NOW()`,
      [req.user.id, slot, String(brand).trim(), String(model).trim()]
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
