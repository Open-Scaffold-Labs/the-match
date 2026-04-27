require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const express = require('express')
const cors    = require('cors')
const db      = require('./db')

const app = express()

app.set('trust proxy', 1)
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '10mb' })) // Eagle Eye images are large

// — Health check (responds immediately, no DB dependency) —
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', db: db.ready !== null })
})

// — Lazy DB init gate —
let dbReady = false
db.init().then(() => { dbReady = true }).catch(() => {})

app.use('/api', (req, res, next) => {
  if (dbReady) return next()
  // Let auth callback through so cold-start login still works
  if (req.path.startsWith('/auth')) return next()
  res.status(503).json({ error: 'Server starting — please retry in a moment' })
})

// — Routes —
app.use('/api/auth',      require('./routes/auth'))
app.use('/api/rounds',    require('./routes/rounds'))
app.use('/api/stats',     require('./routes/stats'))
app.use('/api/outings',   require('./routes/outings'))
app.use('/api/eagle-eye', require('./routes/eagle-eye'))

// — 404 fallback —
app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// — Error handler —
app.use((err, req, res, _next) => {
  console.error('[error]', err.message)
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' })
})

const PORT = process.env.PORT ?? 3010
app.listen(PORT, () => console.log(`[the-match] server on :${PORT}`))

module.exports = app
