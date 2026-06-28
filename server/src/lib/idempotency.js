// F.5 S3 — idempotency engine. Makes a replayed mutation (dropped ack,
// reconnect, or app restart re-sending a queued score write) harmless:
// applied exactly once, with a byte-identical reply on the replay.
//
// CRITICAL design choice (the single highest-leverage correctness decision):
// the key claim, the actual write (doWork), and the stored response all
// commit in ONE transaction. `claimAndRun` MUST be called inside db.tx, with
// the same `client`. Because the claim is uncommitted until the work finishes,
// a crash mid-write rolls the claim back with it — there is never an orphaned
// "started" row, and a concurrent same-key request blocks on the INSERT then
// transparently replays the committed response. This is why this module needs
// no TTL-based correctness and no separate stale-lock recovery job.
//
// Uniqueness is scoped (user_id, idempotency_key) — never global. request_hash
// (sha256 of the canonical body) catches a key reused with a different payload
// → 422 rather than a wrong cached reply. Retention (created_at) drives storage
// cleanup only; an offline golf phone can outlast any TTL, so dedup correctness
// must not depend on it.

const crypto = require('crypto')

// Canonical body hash — stable key order so {a:1,b:2} and {b:2,a:1} match.
function hashBody(body) {
  const obj = body && typeof body === 'object' ? body : {}
  const canon = JSON.stringify(obj, Object.keys(obj).sort())
  return crypto.createHash('sha256').update(canon).digest('hex')
}

// Run `doWork(client)` exactly once per (userId, key). doWork must return
// { status, body }. Returns { status, body, replayed }.
//   - first claim         → runs doWork, stores + returns it (replayed:false)
//   - replay (same body)  → returns the stored response (replayed:true), no work
//   - same key, diff body → 422 idempotency_key_reuse (no work)
//   - concurrent same key → blocks on the INSERT, then replays the winner
async function claimAndRun(client, { userId, key, method, path, body }, doWork) {
  const hash = hashBody(body)
  const ins = await client.query(
    `INSERT INTO tm_idempotency_keys
       (user_id, idempotency_key, request_method, request_path, request_hash, recovery_point, locked_at)
     VALUES ($1,$2,$3,$4,$5,'started', now())
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [userId, key, method, path, hash]
  )

  if (ins.rowCount === 1) {
    // We are the first claimant. Do the work and persist the response so any
    // later replay is byte-identical. All within the caller's transaction.
    const result = await doWork(client)
    await client.query(
      `UPDATE tm_idempotency_keys
         SET recovery_point='finished', locked_at=NULL, response_code=$2, response_body=$3
       WHERE id=$1`,
      [ins.rows[0].id, result.status, JSON.stringify(result.body)]
    )
    return { ...result, replayed: false }
  }

  // Key already exists (committed by a prior, completed request — or a
  // concurrent one we just blocked behind). Read the committed row.
  const { rows } = await client.query(
    `SELECT id, request_hash, recovery_point, response_code, response_body
       FROM tm_idempotency_keys
      WHERE user_id=$1 AND idempotency_key=$2`,
    [userId, key]
  )
  const row = rows[0]
  if (!row) {
    // Row was cleaned up between the conflict and this read (extremely rare).
    // Safe to just do the work — doWork is the source of truth.
    const result = await doWork(client)
    return { ...result, replayed: false }
  }
  if (row.request_hash !== hash) {
    return {
      status: 422,
      body: { error: 'idempotency_key_reuse', message: 'This idempotency key was already used with a different request.' },
      replayed: false,
    }
  }
  if (row.recovery_point === 'finished') {
    return { status: row.response_code, body: row.response_body, replayed: true }
  }
  // 'started' should be unreachable under the single-transaction model (an
  // unfinished claim is uncommitted, hence invisible to other transactions).
  // Defensive fallback if the claim is ever split out of the work transaction.
  return {
    status: 409,
    body: { error: 'request_in_progress', message: 'This request is already being processed.' },
    replayed: false,
  }
}

// Opportunistic storage cleanup. Correctness does NOT depend on this — it only
// bounds table growth. 7 days comfortably covers a phone left offline a weekend.
async function cleanupOldKeys(db, days = 7) {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM tm_idempotency_keys WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(days)]
    )
    return rowCount
  } catch (e) {
    console.warn('[idempotency] cleanup failed', e.message)
    return 0
  }
}

module.exports = { claimAndRun, hashBody, cleanupOldKeys }
