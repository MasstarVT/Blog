import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseYouTubeFeed, normalizePlaylistItems, decodeXmlEntities, uploadsPlaylistId,
} from '../../src/lib/normalize/youtube.mjs'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const VIDEO_KEYS = ['id', 'publishedAt', 'thumbnail', 'title', 'url']

test('YouTube channel feed (real response)', () => {
  const videos = parseYouTubeFeed(fixture('youtube-feed.xml'))
  assert.equal(videos.length, 3)
  for (const v of videos) {
    assert.deepEqual(Object.keys(v).sort(), VIDEO_KEYS)
    assert.match(v.id, /^[A-Za-z0-9_-]{11}$/)
    assert.match(v.url, /^https:\/\/www\.youtube\.com\//)
    assert.match(v.thumbnail, /^https:\/\/i\d?\.ytimg\.com\/vi\//)
    assert.match(v.publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
  }
  assert.deepEqual(videos[0], {
    id: 'DLOQOUWmRpI',
    title: 'The Apple Product I Still Fanboy Over - AirPods 5 Review',
    url: 'https://www.youtube.com/watch?v=DLOQOUWmRpI',
    thumbnail: 'https://i1.ytimg.com/vi/DLOQOUWmRpI/hqdefault.jpg',
    publishedAt: '2026-09-24T18:18:23.000Z',
  })
  assert.equal(parseYouTubeFeed(fixture('youtube-feed.xml'), { limit: 1 }).length, 1)
})

test('YouTube feed: entities, shorts links, missing thumbnails', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><yt:videoId>abcDEF12345</yt:videoId><title>Tom &amp; Jerry &#39;live&#39; &lt;3 &#x1F525;</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/abcDEF12345"/><published>2026-09-01T10:00:00+00:00</published></entry>
  <entry><yt:videoId>bad id!</yt:videoId><title>skip</title></entry>
  </feed>`
  assert.deepEqual(parseYouTubeFeed(xml), [{
    id: 'abcDEF12345',
    title: "Tom & Jerry 'live' <3 \u{1F525}",
    url: 'https://www.youtube.com/shorts/abcDEF12345',
    thumbnail: 'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg',
    publishedAt: '2026-09-01T10:00:00.000Z',
  }])
})

test('YouTube feed: HTML error pages are rejected', () => {
  assert.throws(() => parseYouTubeFeed('<!DOCTYPE html><html>consent</html>'), /not an Atom feed/)
})

test('decodeXmlEntities', () => {
  assert.equal(decodeXmlEntities('&quot;a&quot; &amp;amp; &#65;&#x42; &unknown;'), '"a" &amp; AB &unknown;')
})

test('Data API playlistItems fallback', () => {
  assert.equal(uploadsPlaylistId('UCabc123'), 'UUabc123')
  const videos = normalizePlaylistItems(JSON.parse(fixture('youtube-playlist-items.json')))
  assert.deepEqual(videos, [{
    id: 'abcDEF12345',
    title: 'VTuber setup tour',
    url: 'https://www.youtube.com/watch?v=abcDEF12345',
    thumbnail: 'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg',
    publishedAt: '2026-09-21T18:00:00.000Z',
  }])
})
