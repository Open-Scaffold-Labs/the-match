// Follow-up: complete the 18-hole card on test outing 8L3U and re-end so the
// fan-out emits tm_rounds (the emitter correctly skips incomplete cards).
import { readFileSync } from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const jwt = require('jsonwebtoken')

const BASE = 'https://the-match-roan.vercel.app/api/v1'
const SECRET = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^JWT_SECRET=["']?([^"'\n]+)/m)[1]
const A = jwt.sign({ sub: 2 }, SECRET, { expiresIn: '30m' })
const CODE = '8L3U'

const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A}` }, body: body ? JSON.stringify(body) : undefined })
  return r.status
}
for (let h = 9; h < 18; h++) {
  const s1 = await call('PUT', `/outings/${CODE}/scores`, { hole: h, score: 4, putts: 2, firstPutt: '3-10' })
  const s2 = await call('PUT', `/outings/${CODE}/scores/host`, { hole: h, score: 4, user_id: 14 })
  if (s1 !== 200 || s2 !== 200) console.log(`hole ${h}: A=${s1} B=${s2}`)
}
console.log('holes 10-18 filled; re-ending:', await call('POST', `/outings/${CODE}/end`, {}))
