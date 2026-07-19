// Unit tests for archive batch grouping + orchestration (lib/swingBatch.mjs).
// Run: node --test client/src/lib/__tests__/swing-batch.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupFilesByDate, analyzeBatch } from '../swingBatch.mjs'

const D = (s) => new Date(s + 'T12:00:00Z').getTime()

test('groupFilesByDate: by UTC day, sorted, undated excluded', () => {
  const files = [
    { name: 'b.mov', lastModified: D('2024-06-02') },
    { name: 'a.mov', lastModified: D('2024-06-01') },
    { name: 'c.mov', lastModified: D('2024-06-02') + 3600_000 },
    { name: 'undated.mov', lastModified: 0 },
  ]
  const g = groupFilesByDate(files)
  assert.equal(g.length, 2)
  assert.equal(g[0].date, '2024-06-01')
  assert.equal(g[1].files.length, 2)
})

test('analyzeBatch: groups, analyzes, skips honestly', async () => {
  const files = [
    { name: 'swing1.mp4', lastModified: D('2024-06-01') },
    { name: 'swing2.mp4', lastModified: D('2024-06-01') },
    { name: 'swing3.mp4', lastModified: D('2024-06-02') },
    { name: 'notes.txt', lastModified: D('2024-06-02') },
    { name: 'broken.mp4', lastModified: D('2024-06-02') },
  ]
  const progress = []
  const io = {
    analyze: async (f) => {
      if (f.name === 'broken.mp4') return { error: 'unreadable_clip' }
      return { motion: [0, 1], audio: null, fps: 30, duration_ms: 4000 }
    },
    engine: () => ({ duration_ms: 1200, tempo_ratio: 3.0, frames: { takeaway: 1, top: 2, impact: 3 }, flags: ['no_impact_audio'] }),
    onProgress: (d, t, name) => progress.push([d, t, name]),
  }
  const { sessions, skipped } = await analyzeBatch(files, io)
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].swings.length, 2)
  assert.equal(sessions[0].source, 'archive')
  assert.equal(sessions[0].context, 'import')
  assert.deepEqual(sessions[0].swings[0].duration_ms, 1200)
  assert.ok(skipped.some((s) => s.file === 'notes.txt' && s.reason === 'not_a_video'))
  assert.ok(skipped.some((s) => s.file === 'broken.mp4' && s.reason === 'unreadable_clip'))
  assert.equal(progress.length, 4) // only videos counted
})

test('analyzeBatch: analyze throw → analysis_failed skip', async () => {
  const io = {
    analyze: async () => { throw new Error('boom') },
    engine: () => ({}),
  }
  const { sessions, skipped } = await analyzeBatch([{ name: 'x.mp4', lastModified: D('2024-01-01') }], io)
  assert.equal(sessions[0].swings.length, 0)
  assert.equal(skipped[0].reason, 'analysis_failed')
})
