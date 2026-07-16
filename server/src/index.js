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

// — API router (Track F.1 / audit N5: version the API) —
// All resource routes live on ONE router, mounted at BOTH /api/v1 (the
// canonical, versioned path the client now calls) AND /api (a legacy alias
// kept so any not-yet-migrated caller — and old installed app binaries once
// we ship native — keep working). This is what lets us introduce /api/v2
// later without breaking apps frozen on phones. The db-gate lives INSIDE the
// router so its req.path checks ('/auth', '/eagle-eye/...') are relative to
// the mount and work identically under both prefixes.
const apiRouter = express.Router()

// DB gate: await init per-request so serverless cold starts work.
apiRouter.use(async (req, res, next) => {
  if (req.path.startsWith('/auth')) return next()
  if (req.path.startsWith('/eagle-eye/osm')) return next() // OSM proxy — no DB needed
  if (req.path.startsWith('/eagle-eye/elevation')) return next() // DEM proxy — degrades to live USGS without DB
  try {
    await db.init()
    next()
  } catch (e) {
    log.error({ err: e, route: req.path }, '[db-gate] db.init failed')
    res.status(503).json({ error: 'Database unavailable — please retry in a moment' })
  }
})

apiRouter.use('/auth',          require('./routes/auth'))
apiRouter.use('/rounds',        require('./routes/rounds'))
apiRouter.use('/stats',         require('./routes/stats'))
apiRouter.use('/outings',       require('./routes/outings'))
apiRouter.use('/eagle-eye',     require('./routes/eagle-eye'))
apiRouter.use('/profile',       require('./routes/profile'))
apiRouter.use('/friends',       require('./routes/friends'))
apiRouter.use('/follows',       require('./routes/follows'))
apiRouter.use('/games',         require('./routes/games'))
apiRouter.use('/availability',  require('./routes/availability'))
apiRouter.use('/courses',       require('./routes/courses'))
apiRouter.use('/clubs',         require('./routes/clubs'))
apiRouter.use('/onboarding',    require('./routes/onboarding'))
apiRouter.use('/admin',         require('./routes/admin'))
apiRouter.use('/notifications', require('./routes/notifications'))
apiRouter.use('/leagues',       require('./routes/leagues'))
apiRouter.use('/referrals',     require('./routes/referrals'))
apiRouter.use('/practice',      require('./routes/practice'))
apiRouter.use('/caddie',        require('./routes/caddie'))
apiRouter.use('/gameplan',      require('./routes/gameplan'))
apiRouter.use('/voice',         require('./routes/voice'))

// Versioned path first, legacy alias second (order matters for prefix match).
app.use('/api/v1', apiRouter)
app.use('/api',    apiRouter)

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
