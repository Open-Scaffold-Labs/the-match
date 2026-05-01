// /api/onboarding — first-run wizard state + coach-mark tracking.
// (2026-05-01 — Matt: friends-test prep)

const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// Whitelist the steps we accept so a typo or malicious key can't
// pollute the JSONB blob with arbitrary data. Order matters for the
// "blocking" check below — the first 4 are mandatory before the user
// can use the app.
const STEPS = ['welcome', 'handicap', 'home_course', 'first_club', 'friend']
const BLOCKING_STEPS = ['welcome', 'handicap', 'home_course', 'first_club']

// PUT /api/onboarding/step — mark a single step complete.
// Body: { step: 'welcome' | 'handicap' | 'home_course' | 'first_club' | 'friend' }
// Auto-sets onboarding_completed_at when all blocking steps are done.
router.put('/step', async (req, res) => {
  try {
    const { step } = req.body || {}
    if (!STEPS.includes(step)) return res.status(400).json({ error: 'Unknown step' })

    // Read current steps, merge, write back. Single round-trip via
    // jsonb_set keeps it atomic on the row.
    const updated = await db.one(
      `UPDATE tm_users
         SET onboarding_steps = jsonb_set(
               COALESCE(onboarding_steps, '{}'::jsonb),
               $2::text[],
               'true'::jsonb,
               true
             ),
             onboarding_completed_at = CASE
               WHEN onboarding_completed_at IS NOT NULL THEN onboarding_completed_at
               WHEN (
                 jsonb_set(COALESCE(onboarding_steps, '{}'::jsonb), $2::text[], 'true'::jsonb, true)
                 @> $3::jsonb
               ) THEN NOW()
               ELSE NULL
             END
       WHERE id = $1
       RETURNING onboarding_steps, onboarding_completed_at`,
      [
        req.user.id,
        `{${step}}`,
        JSON.stringify(Object.fromEntries(BLOCKING_STEPS.map(s => [s, true]))),
      ]
    )
    res.json({ ok: true, ...updated })
  } catch (err) {
    console.error('[onboarding/step]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// PUT /api/onboarding/coach-mark — mark a coach mark as seen.
// Body: { mark: 'home' | 'match' | 'eagle_eye' | 'bag' | 'tour' | etc }
router.put('/coach-mark', async (req, res) => {
  try {
    const { mark } = req.body || {}
    if (!mark || typeof mark !== 'string' || mark.length > 32) {
      return res.status(400).json({ error: 'Invalid mark' })
    }
    const safeKey = mark.replace(/[^a-z0-9_]/gi, '')
    if (!safeKey) return res.status(400).json({ error: 'Invalid mark' })

    await db.query(
      `UPDATE tm_users
         SET coach_marks_seen = jsonb_set(
               COALESCE(coach_marks_seen, '{}'::jsonb),
               $2::text[],
               'true'::jsonb,
               true
             )
       WHERE id = $1`,
      [req.user.id, `{${safeKey}}`]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[onboarding/coach-mark]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// POST /api/onboarding/complete — explicit "skip the rest" exit.
// Sets onboarding_completed_at even if some non-blocking steps remain.
router.post('/complete', async (req, res) => {
  try {
    await db.query(
      `UPDATE tm_users
         SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
       WHERE id = $1`,
      [req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[onboarding/complete]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
