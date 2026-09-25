import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseTwitchDuration, helixThumbnail, normalizeSchedule, normalizeVideos, normalizeClips, mergeClips, emptyHelixSchedule,
} from '../../src/lib/normalize/helix.mjs'

const json = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const NOW = new Date('2026-10-25T12:00:00Z')

const SEGMENT_KEYS = ['canceled', 'category', 'end', 'id', 'recurring', 'start', 'title']
const VIDEO_KEYS = ['durationSec', 'id', 'publishedAt', 'thumbnail', 'title', 'type', 'url', 'views']
const CLIP_KEYS = ['createdAt', 'creator', 'durationSec', 'id', 'thumbnail', 'title', 'url', 'views']

test('parseTwitchDuration', () => {
  assert.equal(parseTwitchDuration('3h2m1s'), 10921)
  assert.equal(parseTwitchDuration('45s'), 45)
  assert.equal(parseTwitchDuration('12m'), 720)
  assert.equal(parseTwitchDuration('1h'), 3600)
  assert.equal(parseTwitchDuration('1m30.6s'), 91)
  assert.equal(parseTwitchDuration(28.4), 28)
  assert.equal(parseTwitchDuration(''), null)
  assert.equal(parseTwitchDuration('abc'), null)
  assert.equal(parseTwitchDuration(null), null)
})

test('helixThumbnail fills the template and drops placeholders', () => {
  assert.equal(helixThumbnail('https://x.jtvnw.net/thumb0-%{width}x%{height}.jpg'), 'https://x.jtvnw.net/thumb0-640x360.jpg')
  assert.equal(helixThumbnail('https://x.jtvnw.net/t-{width}x{height}.jpg', 320, 180), 'https://x.jtvnw.net/t-320x180.jpg')
  assert.equal(helixThumbnail('https://vod-secure.twitch.tv/_404/404_processing_%{width}x%{height}.png'), null)
  assert.equal(helixThumbnail(''), null)
  assert.equal(helixThumbnail(null), null)
  assert.equal(helixThumbnail('http://insecure/t.jpg'), null)
})

test('normalizeSchedule: drops ended and far-future segments, sorts, fills blanks', () => {
  const s = normalizeSchedule(json('helix-schedule.json'), { now: NOW })
  assert.equal(s.source, 'helix')
  assert.deepEqual(s.vacation, { start: '2026-11-10T00:00:00.000Z', end: '2026-11-20T00:00:00.000Z' })
  assert.deepEqual(s.segments.map((x) => x.start), ['2026-10-27T23:00:00.000Z', '2026-10-29T23:00:00.000Z'])
  for (const seg of s.segments) assert.deepEqual(Object.keys(seg).sort(), SEGMENT_KEYS)
  const [tue, canceled] = s.segments
  assert.deepEqual(tue, {
    id: 'eyJzZWdtZW50SUQiOiJiIiwiaXNvWWVhciI6MjAyNiwiaXNvV2VlayI6NDR9',
    title: 'Tuesday variety', category: 'Minecraft',
    start: '2026-10-27T23:00:00.000Z', end: '2026-10-28T02:00:00.000Z', recurring: true, canceled: false,
  })
  assert.equal(canceled.title, 'Stream')
  assert.equal(canceled.category, null)
  assert.equal(canceled.canceled, true)
})

test('normalizeSchedule: horizon, limit and expired vacation', () => {
  const s = normalizeSchedule(json('helix-schedule.json'), { now: NOW, days: 120, limit: 10 })
  assert.equal(s.segments.length, 3)
  assert.equal(s.segments.at(-1).title, 'Too far ahead')
  const later = normalizeSchedule(json('helix-schedule.json'), { now: '2026-12-01T00:00:00Z', days: 60 })
  assert.equal(later.vacation, null)
  assert.equal(normalizeSchedule(json('helix-schedule.json'), { now: NOW, limit: 1 }).segments.length, 1)
})

test('normalizeSchedule on a 404 body / nothing → empty', () => {
  assert.deepEqual(normalizeSchedule(json('helix-404.json'), { now: NOW }), emptyHelixSchedule())
  assert.deepEqual(normalizeSchedule(null), emptyHelixSchedule())
})

test('normalizeVideos', () => {
  const v = normalizeVideos(json('helix-videos.json'))
  assert.equal(v.length, 3)
  for (const x of v) assert.deepEqual(Object.keys(x).sort(), VIDEO_KEYS)
  assert.deepEqual(v[0], {
    id: '2300000001', type: 'archive', title: 'Swimming in a new sea',
    url: 'https://www.twitch.tv/videos/2300000001',
    thumbnail: 'https://static-cdn.jtvnw.net/cf_vods/d2nvs31859zcd8/abc_masstarvt_40000000000_1747344872//thumb/thumb0-640x360.jpg',
    publishedAt: '2026-05-15T21:34:40.000Z', durationSec: 10921, views: 88,
  })
  assert.equal(v[1].type, 'highlight')
  assert.equal(v[1].thumbnail, null, 'processing placeholder → null')
  assert.equal(v[1].durationSec, 45)
  assert.equal(v[2].type, 'upload')
  assert.equal(v[2].thumbnail, null, 'empty thumbnail → null')
  assert.deepEqual(normalizeVideos({}), [])
})

test('normalizeClips', () => {
  const c = normalizeClips(json('helix-clips-recent.json'))
  assert.equal(c.length, 2)
  for (const x of c) assert.deepEqual(Object.keys(x).sort(), CLIP_KEYS)
  assert.equal(c[0].durationSec, 28.5)
  assert.equal(c[0].creator, 'ClipperOne')
  assert.equal(c[0].thumbnail, 'https://static-cdn.jtvnw.net/twitch-clips-thumbnails-prod/PopularButOlderClip-abc/preview-480x272.jpg')
  assert.equal(c[1].creator, null)
  assert.equal(c[1].durationSec, 14)
})

test('mergeClips: newest first, topped up with de-duplicated all-time clips', () => {
  const recent = normalizeClips(json('helix-clips-recent.json'))
  const allTime = normalizeClips(json('helix-clips-alltime.json'))
  const merged = mergeClips(recent, allTime, 4)
  assert.deepEqual(merged.map((c) => c.id), ['NewerClip-def', 'PopularButOlderClip-abc', 'AllTimeSecond-222', 'AllTimeTop-111'])

  const many = [1, 2, 3, 4, 5].map((i) => ({ id: `c${i}`, createdAt: `2026-09-0${i}T00:00:00.000Z` }))
  assert.deepEqual(mergeClips(many, allTime).map((c) => c.id), ['c5', 'c4', 'c3', 'c2', 'c1'])
  assert.deepEqual(mergeClips([], []), [])
})
