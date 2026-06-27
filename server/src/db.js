const { Pool } = require('pg')

// Supabase session pooler works without SSL on free tier local dev.
// In prod (Vercel), DATABASE_URL will have ?sslmode=require appended by Vercel env.
const isProduction = process.env.NODE_ENV === 'production'

// Serverless connection discipline (Track F.2 / audit N6): on Vercel each
// warm lambda handles one request at a time, so a large per-instance pool is
// wasted and actively harmful — hundreds of concurrent lambdas × N connections
// exhausts the Supabase pooler ("remaining connection slots are reserved").
// Keep prod tiny (1–2); local dev can hold a few for concurrent client calls.
// NOTE: DATABASE_URL must point at the Supabase *transaction-mode* pooler
// (port 6543) in prod, not session mode (5432) — confirm in Vercel env.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: isProduction ? 2 : 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: isProduction, // let idle serverless instances release cleanly
})

// Lazy init — don't block /health on DB
const db = {
  ready: null,
  pool,

  async init() {
    if (this.ready) return this.ready
    this.ready = pool.query('SELECT 1').then(() => true).catch(e => {
      console.error('[db] init failed:', e.message)
      this.ready = null
      throw e
    })
    return this.ready
  },

  async query(sql, params) {
    return pool.query(sql, params)
  },

  async one(sql, params) {
    const { rows } = await pool.query(sql, params)
    return rows[0] ?? null
  },

  async many(sql, params) {
    const { rows } = await pool.query(sql, params)
    return rows
  },
}

module.exports = db
