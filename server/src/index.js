require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const express = require('express')
const cors    = require('cors')
const db      = require('./db')
const log     = require('./logger')
const { httpLogger } = require('./logger')

const app = express()

app.set('trust proxy', 1)
app.use(httpLogger)  // structured per-request log (req.id, method, url, status, duration)
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '10mb' })) // Eagle Eye images are large

// — Health check (responds immediately, no DB dependency) —
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', db: db.ready !== null })
})

// — DB gate: await init per-request so serverless cold starts work —
app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/auth')) return next()
  if (req.path.startsWith('/eagle-eye/osm')) return next() // OSM proxy — no DB needed
  try {
    await db.init()
    next()
  } catch (e) {
    log.error({ err: e, route: req.path }, '[db-gate] db.init failed')
    res.status(503).json({ error: 'Database unavailable — please retry in a moment' })
  }
})

// — Routes —
app.use('/api/auth',         require('./routes/auth'))
app.use('/api/rounds',       require('./routes/rounds'))
app.use('/api/stats',        require('./routes/stats'))
app.use('/api/outings',      require('./routes/outings'))
app.use('/api/eagle-eye',    require('./routes/eagle-eye'))
app.use('/api/profile',      require('./routes/profile'))
app.use('/api/friends',      require('./routes/friends'))
app.use('/api/follows',      require('./routes/follows'))
app.use('/api/games',        require('./routes/games'))
app.use('/api/availability', require('./routes/availability'))
app.use('/api/courses',     require('./routes/courses'))
app.use('/api/clubs',        require('./routes/clubs'))

// — 404 fallback —
app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// — Error handler —
app.use((err, req, res, _next) => {
  // req.log exists per-request thanks to pino-http; falls back to global
  // logger if the error fired before httpLogger ran.
  ;(req.log || log).error({ err, route: req.path }, 'unhandled route error')
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' })
})

const PORT = process.env.PORT ?? 3010
app.listen(PORT, () => log.info({ port: PORT }, '[the-match] server started'))

module.exports = app
