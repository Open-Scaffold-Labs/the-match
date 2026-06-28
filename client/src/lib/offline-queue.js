// Offline mutation queue. Golf courses have spotty cell — players
// shouldn't lose scores when reception drops. Wrap any mutation that
// MUST eventually reach the server in `runWithQueue`. If the network
// is down at write time, the mutation is JSON-serialized into
// localStorage and replayed automatically when the device comes
// back online.
//
// Conventions:
//   - Last-write-wins per (url, body shape) — replays don't dedupe;
//     if you tap hole-7 score 4 then 5 while offline, both get
//     queued and the second overwrites the first on the server.
//     Score-conflict warnings (B2) are skipped on replay because
//     the user already confirmed the local value.
//   - Token attached at REPLAY time (from current localStorage).
//     Don't capture an old token in the queue.
//   - Queue is drained sequentially. If one mutation fails, we stop
//     and try again later — preserves causal order (e.g. "set hole 7
//     to 4 BEFORE set hole 7 to 5").
//
// (2026-05-01 — league must-have B5.)

const QUEUE_KEY = 'tm-offline-queue'

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) }
  catch (err) {
    // Quota exceeded or storage disabled. Drop oldest items first
    // until it fits — preserves the most recent (likely most
    // important) writes.
    if (err.name === 'QuotaExceededError' && q.length > 0) {
      try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50))) } catch { /* give up */ }
    }
  }
}

export function getQueueSize() {
  return readQueue().length
}

// Subscribe to queue-size changes. Returns an unsubscribe fn. Used
// by the optional offline indicator badge.
const listeners = new Set()
function notify() {
  for (const fn of listeners) { try { fn(getQueueSize()) } catch { /* ignore */ } }
}
export function subscribeQueue(fn) {
  listeners.add(fn)
  // Push initial value so the subscriber renders immediately.
  try { fn(getQueueSize()) } catch { /* ignore */ }
  return () => listeners.delete(fn)
}

function enqueue(mutation) {
  const q = readQueue()
  q.push({ ...mutation, queuedAt: Date.now() })
  writeQueue(q)
  notify()
}

// Network errors throw a TypeError in fetch (or the AbortController
// throws AbortError). Distinguish those from HTTP errors so we only
// queue genuine network failures. HTTP 4xx/5xx aren't queued — those
// are real server responses and need to surface to the user.
function isNetworkError(err) {
  if (!err) return false
  if (err.name === 'TypeError') return true              // fetch network fail
  if (err.name === 'AbortError') return true              // controller abort
  if (typeof err.message === 'string' && /network|failed to fetch|load failed/i.test(err.message)) return true
  return false
}

// Single shared drain promise so simultaneous triggers don't
// double-replay an item.
let draining = null

// Subscriber for "permanently dropped mutations" so the UI can roll
// back the optimistic local update + show the user. (Iteration 3 fix.)
const dropListeners = new Set()
function notifyDrop(item, reason) {
  for (const fn of dropListeners) { try { fn(item, reason) } catch { /* ignore */ } }
}
export function subscribeQueueDrops(fn) {
  dropListeners.add(fn)
  return () => dropListeners.delete(fn)
}

export async function drainQueue() {
  if (draining) return draining
  draining = (async () => {
    let q = readQueue()
    let drained = 0
    while (q.length > 0) {
      const item = q[0]
      const token = (() => { try { return localStorage.getItem('tm_token') } catch { return null } })()
      let dropped = false
      let dropReason = null
      try {
        const res = await fetch(item.url, {
          method: item.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            // F.5 S3: replay the SAME idempotency key the original action was
            // tagged with, so a reconnect/restart replay is deduped server-side
            // and applied exactly once (never double-applied).
            ...(item.idempotencyKey ? { 'Idempotency-Key': item.idempotencyKey } : {}),
          },
          body: item.body ? JSON.stringify(item.body) : undefined,
        })
        if (!res.ok) {
          // Round 5 audit fix — DON'T auto-force-retry on 409.
          //
          // The previous behavior force-retried any 409 conflict
          // during queue drain. That silently clobbered legitimate
          // edits made while the user was offline (e.g. host
          // correction of a player's score: player's queued write
          // would resurrect on reconnect via force, undoing the
          // correction with no signal to anyone).
          //
          // New behavior: drop the conflicting mutation and notify
          // via subscribeQueueDrops. The user sees "your hole-7
          // entry of 5 didn't sync — current value is 4" and can
          // re-enter explicitly if they still want to overwrite.
          // The original force-retry path is only kept for cases
          // where the body itself was authored with force:true (host
          // correction queued offline) — those are explicit overwrites
          // the user already confirmed.
          if (res.status === 409 && item.body && item.body.force === true) {
            // Original write was force — author already confirmed.
            // Server still rejecting force-write means something more
            // fundamental is wrong (permission, validation). Drop.
            const errBody = await res.json().catch(() => null)
            console.warn('[offline-queue] dropping force-write 409', errBody, item)
            dropped = true
            dropReason = `server rejected force-write (${res.status})`
          } else if (res.status === 409) {
            // Non-force write hit a conflict. Read the response body
            // so the drop reason can carry the actual cause —
            // score_conflict (someone else entered first) vs.
            // player_withdrawn (host pulled the player) are surfaced
            // differently in the UI. (33-round audit fix.)
            const errBody = await res.json().catch(() => ({}))
            console.warn('[offline-queue] dropping conflicting non-force write', errBody, item)
            dropped = true
            if (errBody?.error === 'player_withdrawn') {
              dropReason = errBody?.message || 'this player was withdrawn while you were offline'
            } else if (errBody?.existing_score != null) {
              dropReason = `someone else recorded a different score (${errBody.existing_score})`
            } else {
              dropReason = 'a conflicting score was recorded while you were offline'
            }
          } else {
            console.warn('[offline-queue] dropping mutation', res.status, item)
            dropped = true
            dropReason = `server rejected (${res.status})`
          }
        }
        // Pop regardless (either accepted or unrecoverable).
        q = q.slice(1)
        writeQueue(q)
        drained++
        notify()
        if (dropped) notifyDrop(item, dropReason)
      } catch (err) {
        if (isNetworkError(err)) break  // still offline, try later
        // Unknown failure — drop the item so the queue doesn't wedge,
        // and notify so the UI can roll the local state back.
        console.warn('[offline-queue] dropping after error', err.message, item)
        q = q.slice(1)
        writeQueue(q)
        notify()
        notifyDrop(item, `network error: ${err.message}`)
      }
    }
    return { drained, remaining: q.length }
  })()
  try { return await draining } finally { draining = null }
}

// runWithQueue: try the mutation immediately. If it fails with a
// network error, queue it and resolve with { queued: true }. The
// caller is responsible for optimistically updating UI state.
//
// Successful writes return the parsed response body (so callers
// don't have to know whether they're getting through or queued —
// they can branch on result.queued).
export async function runWithQueue({ url, method = 'POST', body, idempotencyKey }) {
  const token = (() => { try { return localStorage.getItem('tm_token') } catch { return null } })()
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // F.5 S3: tag the immediate attempt with the SAME key that gets stored
        // on the queued copy. This closes the dangerous hole where the write
        // commits server-side but the ack is lost → caller sees a network error
        // → the request is enqueued → replay would double-apply. Same key on
        // both attempts means the server dedupes it.
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      // Real HTTP error — let the caller handle it (e.g. 409 conflict).
      const errBody = await res.json().catch(() => ({ error: res.statusText }))
      const err = Object.assign(new Error(errBody.error ?? 'Request failed'), {
        status: res.status, payload: errBody,
      })
      throw err
    }
    return await res.json()
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue({ url, method, body, idempotencyKey })
      return { queued: true }
    }
    throw err
  }
}

// Auto-drain on online events + an interval ping for cases where
// `online` doesn't fire (e.g. captive portals that say "online" but
// can't actually reach the server).
//
// F.5 S3 — jittered drain. A whole foursome (or a clubhouse of phones)
// regains signal at roughly the same moment; firing every queue at once is a
// synchronized "thundering herd" at the server. A small random delay before
// each drain spreads the replays out. Idempotency keys make any replay during
// the spread harmless, so the jitter only needs to smooth load, not guarantee
// ordering (the queue is already strict-FIFO per device).
function jitter(maxMs) { return Math.floor(Math.random() * maxMs) }
function scheduleDrain(maxJitterMs) {
  setTimeout(() => { if (navigator.onLine) drainQueue().catch(() => {}) }, jitter(maxJitterMs))
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => scheduleDrain(4_000))
  // Backgrounded tabs that come back to the foreground should try too.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleDrain(2_000)
  })
  setInterval(() => scheduleDrain(5_000), 30_000)
}
