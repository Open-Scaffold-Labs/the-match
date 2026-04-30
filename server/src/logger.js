// Structured logger — pino + pino-http. Replaces ad-hoc console.error
// throughout the server with structured JSON logs that ship cleanly to
// Vercel logs. Each log line is a JSON object with timestamp, severity,
// request id, and any context the caller adds.
//
// Why pino: it's the lightest + fastest Node logger, designed for
// serverless. Async I/O, low overhead. (Audit F-T7.)
//
// Usage:
//   const log = require('./logger')
//   log.info({ user_id: req.user.id }, 'login successful')
//   log.error({ err, route: '/api/x' }, 'route failed')
//
// In Express: `app.use(httpLogger)` adds one log line per request with
// duration + status code, and exposes `req.log` for per-request context.

const pino = require('pino')

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { app: 'the-match-server' },
  // Plain JSON output everywhere — Vercel logs ingest it cleanly. For
  // local dev with pretty colors, pipe through pino-pretty manually:
  //   npm run dev:server | npx pino-pretty
})

const httpLogger = require('pino-http')({
  logger: baseLogger,
  // Don't log healthcheck noise — they hit /health every cold-start probe
  autoLogging: { ignore: req => req.url === '/health' },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  serializers: {
    req: req => ({ method: req.method, url: req.url, id: req.id }),
    res: res => ({ statusCode: res.statusCode }),
  },
})

module.exports = baseLogger
module.exports.httpLogger = httpLogger
