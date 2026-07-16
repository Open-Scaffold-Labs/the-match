// Talk Your Round — Phase 1 "Round Mode" realtime session manager.
// (wiki/synthesis/voice-interface-build-spec-2026-07-15.md)
//
// One continuous speech-to-speech session per round: the PWA opens WebRTC
// DIRECTLY to the realtime provider using a short-lived client secret
// minted by GET /api/voice/session (no audio ever touches our servers).
// The model gets a small tool schema; every tool call is executed by the
// CLIENT through the same handlers the tap UI uses (executeTool), and the
// result string is returned for the model to speak. Context (hole, pars,
// score state) is injected at session start and on every hole change —
// that's what lets the golfer say five words instead of thirty.
//
// Design rules from the spec:
//  - half-duplex, user-barge-in-only (server VAD interrupts assistant audio)
//  - the model NEVER computes scores/status itself — tools return the truth
//  - feature detection: /session 501 → Round Mode unavailable, Phase 0
//    hold-to-talk remains the fallback. This module throws 'unavailable'.
//
// Pure helpers (buildInstructions, buildContextBlock, ROUND_MODE_TOOLS,
// parseToolArgs) are exported for node --test coverage.

import { api } from './api.js'

// ── Tool schema (mirrors Phase 0 intents + set_hole; enums locked to the
//    SG fact vocabulary — keep in sync with server/src/lib/voice). ─────────────
export const ROUND_MODE_TOOLS = [
  {
    type: 'function', name: 'log_hole_score',
    description: 'Record the golfer\'s score on a hole, with putt facts when stated.',
    parameters: {
      type: 'object', required: ['score'],
      properties: {
        hole: { type: 'integer', description: 'Hole number; omit for the active hole.' },
        score: { type: 'integer', description: 'Strokes. Resolve birdie/bogey/etc against the hole par from context.' },
        putts: { type: 'integer' },
        firstPutt: { type: 'string', enum: ['in3', '3-10', '10-25', '25plus'], description: 'First-putt distance bucket (feet).' },
      },
    },
  },
  {
    type: 'function', name: 'log_shot',
    description: 'Record a shot fact on the active hole: club and/or lie and/or yards to the pin.',
    parameters: {
      type: 'object',
      properties: {
        club: { type: 'string', description: 'Normalized like "driver", "7i", "PW".' },
        lie: { type: 'string', enum: ['tee', 'fairway', 'rough', 'sand', 'recovery', 'green'] },
        toPin: { type: 'integer', description: 'Yards to the pin before the next shot.' },
      },
    },
  },
  {
    type: 'function', name: 'set_hole',
    description: 'Move the active hole (golfer says "on six now" / "moving to seven").',
    parameters: { type: 'object', required: ['hole'], properties: { hole: { type: 'integer' } } },
  },
  {
    type: 'function', name: 'get_round_status',
    description: 'The golfer asks how they stand. Returns the true score line — speak it as returned.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function', name: 'undo_last',
    description: 'Undo/clear the most recently recorded hole ("scratch that").',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function', name: 'get_caddie_advice',
    description: 'Strategy/club question. Returns the Caddie\'s answer grounded in the player\'s real profile — relay it faithfully, condensed for speech.',
    parameters: { type: 'object', required: ['question'], properties: { question: { type: 'string' } } },
  },
]

export function buildInstructions() {
  return [
    'You are The Match Caddie in Round Mode — a sharp, warm golf caddie riding along during a live round.',
    'Style: SHORT. Confirmations under 12 words. Advice under 25 words: club, aim, one reason. Never lecture. Silence is fine — only speak when spoken to or when confirming a tool result.',
    'ALWAYS use tools for facts and writes. Never compute the golfer\'s score or status yourself — call get_round_status and speak what it returns. Never invent yardages, stats, or history.',
    'Golf language: par/birdie/bogey resolve against the hole par in CONTEXT. "Two putts from twenty feet" → putts 2, firstPutt "10-25".',
    'If an utterance is ambiguous, ask one short clarifying question rather than guessing a score.',
    'The golfer may talk to playing partners — if speech clearly isn\'t addressed to you, do not respond.',
  ].join('\n')
}

// Compact context block — refreshed (not accumulated) on hole change.
export function buildContextBlock(ctx = {}) {
  const lines = []
  const holeCount = Number(ctx.holeCount) || 18
  const active = Number(ctx.activeHole)
  if (Number.isFinite(active)) lines.push(`Active hole: ${active} (par ${ctx.pars?.[active - 1] ?? '?'})`)
  if (Array.isArray(ctx.pars)) lines.push(`Pars: ${ctx.pars.slice(0, holeCount).join(',')}`)
  if (Array.isArray(ctx.scores)) {
    const done = ctx.scores.map((s, i) => s ? `H${i + 1}:${s}` : null).filter(Boolean)
    lines.push(done.length ? `Scored: ${done.join(' ')}` : 'Card is empty.')
  }
  if (ctx.courseName) lines.push(`Course: ${String(ctx.courseName).slice(0, 80)}`)
  return `CONTEXT (current round state — trust this, not memory)\n${lines.join('\n')}`
}

export function parseToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  try { return JSON.parse(raw) ?? {} } catch { return {} }
}

// ── Session ──────────────────────────────────────────────────────────────────
// startRoundMode({ getContext, executeTool, onState }) → controller
//   getContext(): round context object (see buildContextBlock)
//   executeTool(name, args): Promise<string> — result the model speaks
//   onState(state): 'connecting' | 'listening' | 'speaking' | 'ended' | 'error'
// controller: { stop(), setMuted(bool), refreshContext(), get muted() }
export async function startRoundMode({ getContext, executeTool, onState }) {
  const emit = (s) => { try { onState?.(s) } catch { /* observer only */ } }
  emit('connecting')

  // 1. Feature-detect + mint. 501 → unavailable (Phase 0 fallback stays).
  let mint
  try {
    mint = await api('/api/voice/session')
  } catch (e) {
    throw new Error(/501|not enabled/i.test(String(e?.message)) ? 'unavailable' : 'mint-failed')
  }
  if (!mint?.clientSecret) throw new Error('mint-failed')

  // 2. Mic + peer connection. Audio out via a detached <audio> element.
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  const pc = new RTCPeerConnection()
  const audioEl = document.createElement('audio')
  audioEl.autoplay = true
  pc.ontrack = (e) => { audioEl.srcObject = e.streams[0] }
  for (const track of mic.getTracks()) pc.addTrack(track, mic)

  // 3. Event channel. Session config rides session.update after open.
  const dc = pc.createDataChannel('oai-events')
  const send = (obj) => { try { dc.send(JSON.stringify(obj)) } catch { /* racing teardown */ } }

  let lastContext = ''
  const sendContext = () => {
    const block = buildContextBlock(getContext?.() ?? {})
    if (block === lastContext) return
    lastContext = block
    send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: block }] },
    })
  }

  dc.onopen = () => {
    send({
      type: 'session.update',
      session: {
        instructions: buildInstructions(),
        tools: ROUND_MODE_TOOLS,
        tool_choice: 'auto',
        // Server VAD = the model hears turn ends; user speech interrupts
        // assistant audio (user-barge-in-only comes free with WebRTC).
        turn_detection: { type: 'server_vad' },
      },
    })
    sendContext()
    emit('listening')
  }

  // 4. Tool-call dispatch. GA event shape is
  //    response.function_call_arguments.done {name, call_id, arguments};
  //    also handle the item-level variant defensively.
  const handled = new Set()
  async function runTool(name, callId, args) {
    if (!name || !callId || handled.has(callId)) return
    handled.add(callId)
    let output
    try {
      output = String(await executeTool(name, parseToolArgs(args)) ?? 'Done.')
    } catch {
      output = 'That didn\'t save — try again.'
    }
    send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: output.slice(0, 500) },
    })
    send({ type: 'response.create' })
    sendContext() // writes may have moved the card — refresh cheaply
  }

  dc.onmessage = (e) => {
    let ev
    try { ev = JSON.parse(e.data) } catch { return }
    switch (ev.type) {
      case 'response.function_call_arguments.done':
        runTool(ev.name, ev.call_id, ev.arguments)
        break
      case 'response.output_item.done':
        if (ev.item?.type === 'function_call') runTool(ev.item.name, ev.item.call_id, ev.item.arguments)
        break
      case 'output_audio_buffer.started':
        emit('speaking')
        break
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
      case 'response.done':
        emit('listening')
        break
      case 'error':
        console.error('[roundmode]', ev.error?.message ?? ev)
        break
      default:
        break
    }
  }

  // 5. SDP handshake straight to the provider (client secret, not our key).
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(mint.model)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mint.clientSecret}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp,
  })
  if (!sdpRes.ok) {
    pc.close(); mic.getTracks().forEach(t => t.stop())
    throw new Error('connect-failed')
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })

  // 6. Keep-awake — cart-mount Round Mode survives the whole side.
  //    (Safari 18.4+ / Chrome; fail-soft everywhere else.)
  let wakeLock = null
  const acquireWake = async () => {
    try { wakeLock = await navigator.wakeLock?.request('screen') } catch { /* optional */ }
  }
  const onVis = () => { if (document.visibilityState === 'visible') acquireWake() }
  acquireWake()
  document.addEventListener('visibilitychange', onVis)

  let stopped = false
  return {
    get muted() { return mic.getAudioTracks().every(t => !t.enabled) },
    setMuted(m) { mic.getAudioTracks().forEach(t => { t.enabled = !m }) },
    refreshContext: sendContext,
    stop() {
      if (stopped) return
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      try { wakeLock?.release() } catch { /* already gone */ }
      try { dc.close() } catch { /* teardown */ }
      try { pc.close() } catch { /* teardown */ }
      mic.getTracks().forEach(t => t.stop())
      audioEl.srcObject = null
      emit('ended')
    },
  }
}
