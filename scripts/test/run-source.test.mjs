import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPart, loadPrevious, skip, SkipError, hasData, generatedDir } from '../lib/run-source.mjs'
import { HttpError } from '../lib/http.mjs'

const NOW = new Date('2026-09-25T12:00:00Z')
const DEF = { fetchedAt: null, status: 'empty', items: [], name: null }

function collect() {
  const reports = []
  return { reports, report: (r) => reports.push(r) }
}

test('ok → data merged over defaults with fetchedAt and status', async () => {
  const { reports, report } = collect()
  const out = await runPart('demo', async () => ({ items: [1, 2], name: 'x' }), null, DEF, { now: NOW, report })
  assert.deepEqual(out, { fetchedAt: '2026-09-25T12:00:00.000Z', status: 'ok', items: [1, 2], name: 'x' })
  assert.deepEqual(Object.keys(out), ['fetchedAt', 'status', 'items', 'name'], 'default key order kept')
  assert.equal(reports[0].status, 'ok')
})

test('a successful empty list is ok, not stale', async () => {
  const prev = { fetchedAt: '2026-09-01T00:00:00.000Z', status: 'ok', items: [9], name: 'old' }
  const out = await runPart('demo', async () => ({ items: [] }), prev, DEF, { now: NOW })
  assert.equal(out.status, 'ok')
  assert.deepEqual(out.items, [])
})

test('failure with previous data → stale, staleSince = previous fetchedAt', async () => {
  const { reports, report } = collect()
  const prev = { fetchedAt: '2026-09-01T00:00:00.000Z', status: 'ok', items: [9], name: 'old' }
  const out = await runPart('demo', async () => { throw new HttpError(502, 'https://api.example/x') }, prev, DEF, { now: NOW, report })
  assert.deepEqual(out, { fetchedAt: '2026-09-01T00:00:00.000Z', status: 'stale', items: [9], name: 'old', staleSince: '2026-09-01T00:00:00.000Z' })
  assert.equal(reports[0].status, 'stale')
  assert.equal(reports[0].error, 'HTTP 502 https://api.example/x')
})

test('failure with previous stale data keeps the original staleSince', async () => {
  const prev = { fetchedAt: '2026-09-01T00:00:00.000Z', status: 'stale', staleSince: '2026-08-30T00:00:00.000Z', items: [9] }
  const out = await runPart('demo', async () => { throw new Error('boom') }, prev, DEF, { now: NOW })
  assert.equal(out.status, 'stale')
  assert.equal(out.staleSince, '2026-08-30T00:00:00.000Z')
})

test('failure without usable previous data → empty defaults', async () => {
  const { reports, report } = collect()
  for (const prev of [null, { fetchedAt: null, status: 'empty', items: [] }, { status: 'ok', items: [1] }]) {
    const out = await runPart('demo', async () => { throw new Error('down') }, prev, DEF, { now: NOW, report })
    assert.deepEqual(out, { ...DEF, status: 'empty' })
  }
  assert.equal(reports.at(-1).error, 'down')
})

test('skip → skipped:<reason>; keepPrevious keeps earlier data', async () => {
  const prev = { fetchedAt: '2026-09-01T00:00:00.000Z', status: 'stale', staleSince: '2026-08-01T00:00:00.000Z', items: [9] }
  const plain = await runPart('demo', async () => skip('not-configured'), prev, DEF, { now: NOW })
  assert.deepEqual(plain, { ...DEF, status: 'skipped:not-configured' })
  const kept = await runPart('demo', async () => skip('no-credentials', { keepPrevious: true }), prev, DEF, { now: NOW })
  assert.deepEqual(kept, { fetchedAt: '2026-09-01T00:00:00.000Z', status: 'skipped:no-credentials', items: [9], name: null })
  const none = await runPart('demo', async () => skip('no-credentials', { keepPrevious: true }), null, DEF, { now: NOW })
  assert.deepEqual(none, { ...DEF, status: 'skipped:no-credentials' })
  assert.ok(new SkipError('x') instanceof Error)
})

test('hasData', () => {
  assert.equal(hasData(null), false)
  assert.equal(hasData({ fetchedAt: null }), false)
  assert.equal(hasData({ fetchedAt: 'x', status: 'empty' }), false)
  assert.equal(hasData({ fetchedAt: 'x', status: { user: 'ok' } }), true)
})

test('loadPrevious: local file → remote → null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prev-'))
  try {
    await writeFile(join(dir, 'discord.json'), JSON.stringify({ fetchedAt: 'local', status: 'ok' }))
    await writeFile(join(dir, 'broken.json'), '{nope')
    const urls = []
    const fetch = async (url) => {
      urls.push(url)
      if (url.endsWith('/bluesky.json')) return new Response('{"fetchedAt":"remote","status":"ok"}', { status: 200 })
      if (url.endsWith('/array.json')) return new Response('[1]', { status: 200 })
      return new Response('nope', { status: 404 })
    }
    const opts = { dir, baseUrl: 'https://deployed.example/data/', fetch }
    assert.deepEqual(await loadPrevious('discord', opts), { fetchedAt: 'local', status: 'ok' })
    assert.deepEqual(await loadPrevious('bluesky', opts), { fetchedAt: 'remote', status: 'ok' })
    assert.equal(await loadPrevious('twitch', opts), null)
    assert.equal(await loadPrevious('broken', opts), null)
    assert.equal(await loadPrevious('array', opts), null)
    assert.ok(urls.includes('https://deployed.example/data/bluesky.json'))
    assert.ok(!urls.some((u) => u.endsWith('/discord.json')), 'local file wins, no network')

    const before = urls.length
    assert.equal(await loadPrevious('bluesky', { ...opts, offline: true }), null)
    assert.equal(urls.length, before, 'offline never fetches')

    const throwing = async () => { throw new TypeError('fetch failed') }
    assert.equal(await loadPrevious('x', { dir, baseUrl: 'https://down.example', fetch: throwing }), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('generatedDir honours GENERATED_DIR', () => {
  assert.match(generatedDir({}), /src[\\/]data[\\/]generated$/)
  assert.ok(generatedDir({ GENERATED_DIR: 'some/dir' }).endsWith(join('some', 'dir')))
})
