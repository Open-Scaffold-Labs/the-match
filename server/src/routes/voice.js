// Talk Your Round — voice routes.
// (wiki/synthesis/voice-interface-build-spec-2026-07-15.md)
//
// Phase 0 (live):    POST /api/voice/parse — transcript → structured intent
//                    (Haiku-class model, forced tool use, sanitized).
// Phase 1 (scaffold): GET /api/voice/session — mints an ephemeral realtime
//                    token for the WebRTC speech-to-speech session. Wired
//                    but returns 501 until OPENAI_API_KEY exists in env,
//                    so the client can feature-detect with one call.

const router = require('express').Router()
const rateLimit = require('express-rate-limit')
const Anthropic = require('@anthropic-ai/sdk')
const requireAuth = require('../middleware/auth')
const { VOICE_TOOL, PARSER_SYSTEM, buildParserContext, sanitizeIntent } = require('../lib/voice')

const client = new Anthropic()

// Every utterance hits this — generous relative to caddie chat, still capped.
const parseLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: { error: 'Voice is catching its breath — give it a minute.' },
})

router.use(requireAuth)

// POST /api/voice/parse
// Body: { transcript, context?: { activeHole, holeCount, pars: [], scores: [] } }
// → { intent, confirmation, ...fields } — the client executes the intent
//   through the same handlers the tap UI uses; nothing is written here.
router.post('/parse', parseLimiter, async (req, res) => {
  const transcript = (typeof req.body?.transcript === 'string' ? req.body.transcript : '')
    .replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 400)
  if (!transcript) return res.status(400).json({ error: 'transcript required' })
  const ctx = (req.body?.context && typeof req.body.context === 'object') ? req.body.context : {}

  try {
    const msg = await client.messages.create({
      // Haiku-class by default: the parse is a classification+extraction task
      // and latency is the product here (spec budget: confirmation < 1.2s).
      model: process.env.VOICE_PARSER_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: PARSER_SYSTEM,
      tools: [VOICE_TOOL],
      tool_choice: { type: 'tool', name: VOICE_TOOL.name },
      messages: [{ role: 'user', content: `${buildParserContext(ctx)}\n\nUTTERANCE\n"${transcript}"` }],
    })
    const block = (msg.content ?? []).find(b => b?.type === 'tool_use' && b.name === VOICE_TOOL.name)
    if (!block?.input) {
      console.error('[voice/parse] no tool_use — stop_reason:', msg.stop_reason)
      throw new Error('empty completion')
    }
    res.json(sanitizeIntent(block.input, ctx))
  } catch (e) {
    console.error('[voice/parse]', e.message)
    res.status(500).json({ error: 'Voice lost signal — try again.' })
  }
})

// GET /api/voice/session — Phase 1 scaffold (Round Mode realtime session).
// Mints a short-lived client token so the PWA opens WebRTC DIRECTLY to the
// realtime provider (no audio through our servers). 501 until the key
// exists; the client treats 501 as "Round Mode unavailable, push-to-talk
// only" — one call, honest feature detection.
router.get('/session', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(501).json({ error: 'Round Mode not enabled on this server yet.' })
  }
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: process.env.VOICE_REALTIME_MODEL || 'gpt-realtime',
          // Tool schema + instructions are configured client-side per
          // session (they carry live round context); the mint stays thin.
        },
      }),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.value) {
      console.error('[voice/session] mint failed', r.status, d?.error?.message)
      return res.status(502).json({ error: 'Could not start Round Mode — try again.' })
    }
    res.json({ clientSecret: d.value, expiresAt: d.expires_at ?? null, model: process.env.VOICE_REALTIME_MODEL || 'gpt-realtime' })
  } catch (e) {
    console.error('[voice/session]', e.message)
    res.status(502).json({ error: 'Could not start Round Mode — try again.' })
  }
})

module.exports = router
