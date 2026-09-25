import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectRows, formatTable, markdownSummary, warningLines, sourceSummaries, isAcceptable } from '../lib/summary.mjs'
import { defaults } from '../../src/data/defaults.mjs'

const files = {
  twitch: {
    ...defaults.twitch,
    status: { user: 'ok', live: 'ok', schedule: 'stale', videos: 'skipped:no-credentials', clips: 'empty' },
    user: { ...defaults.twitch.user, followers: 116 },
    schedule: { source: 'ical', vacation: null, segments: [{}, {}] },
  },
  discord: { ...defaults.discord, status: 'ok', members: 48, online: 18 },
  bluesky: { ...defaults.bluesky, status: 'stale', posts: [{}, {}, {}] },
  youtube: { ...defaults.youtube },
  x: { ...defaults.x, status: 'skipped:not-configured' },
}
const errors = { 'twitch.schedule': 'HTTP 500 https://api.twitch.tv/x', 'twitch.clips': 'down\n100%', bluesky: 'timeout' }

test('isAcceptable', () => {
  assert.equal(isAcceptable('ok'), true)
  assert.equal(isAcceptable('skipped:not-configured'), true)
  assert.equal(isAcceptable('stale'), false)
  assert.equal(isAcceptable('empty'), false)
  assert.equal(isAcceptable(undefined), false)
})

test('rows and console table', () => {
  const rows = collectRows(files, errors)
  assert.equal(rows.length, 9)
  assert.deepEqual(rows.map((r) => r.status), ['ok', 'ok', 'stale', 'skipped:no-credentials', 'empty', 'ok', 'stale', 'skipped:not-configured', 'skipped:not-configured'])
  const table = formatTable(rows)
  assert.match(table, /^source\s+status\s+detail/)
  assert.match(table, /twitch\/schedule\s+stale\s+2 segments \(ical\) \| error: HTTP 500/)
  assert.match(table, /discord\s+ok\s+48 members, 18 online/)
})

test('annotations for every non-ok part: warnings for stale/empty, notices for skipped:*', () => {
  const lines = warningLines(collectRows(files, errors))
  assert.deepEqual(lines, [
    '::warning title=fetch-data twitch/schedule::twitch/schedule is stale (HTTP 500 https://api.twitch.tv/x)',
    '::notice title=fetch-data twitch/videos::twitch/videos is skipped:no-credentials',
    '::warning title=fetch-data twitch/clips::twitch/clips is empty (down%0A100%25)',
    '::warning title=fetch-data bluesky::bluesky is stale (timeout)',
    '::notice title=fetch-data youtube::youtube is skipped:not-configured',
    '::notice title=fetch-data x::x is skipped:not-configured',
  ])
  // an ok part that carried an error note (e.g. X API failed → curated fallback) gets a notice
  const fallback = warningLines(collectRows({ x: { ...defaults.x, status: 'ok', source: 'curated' } }, { x: 'X API failed, using curated posts: HTTP 403' }))
  assert.deepEqual(fallback, ['::notice title=fetch-data x::x is ok (X API failed, using curated posts: HTTP 403)'])
  assert.deepEqual(warningLines(collectRows({ discord: { ...defaults.discord, status: 'ok' } })), [])
})

test('markdown summary and meta sources', () => {
  const md = markdownSummary(collectRows(files, errors), { hash: 'a'.repeat(64), postsHash: 'b'.repeat(64), builtAt: '2026-09-25T00:00:00.000Z' })
  assert.match(md, /\| Source \| Status \| Detail \|/)
  assert.match(md, /\| twitch\/videos \| ⏭️ skipped:no-credentials \|/)
  assert.match(md, /Data hash `aaaaaaaaaaaa`/)
  assert.deepEqual(sourceSummaries(files), {
    twitch: 'user=ok live=ok schedule=stale videos=skipped:no-credentials clips=empty',
    discord: 'ok',
    bluesky: 'stale',
    youtube: 'skipped:not-configured',
    x: 'skipped:not-configured',
  })
  const allOk = { twitch: { status: { user: 'ok', live: 'ok', schedule: 'ok', videos: 'ok', clips: 'ok' } } }
  assert.deepEqual(sourceSummaries(allOk), { twitch: 'ok' })
})
