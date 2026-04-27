const { Pool } = require('pg')

// Supabase session pooler works without SSL on free tier local dev.
// In prod (Vercel), DATABASE_URL will have ?sslmode=require appended by Vercel env.
const isProduction = process.env.NODE_ENV === 'production'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
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
