import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeFeed, normalizeProfile, facetSegments, safeHttps } from '../../src/lib/normalize/bluesky.mjs'

const json = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const POST_KEYS = ['author', 'counts', 'createdAt', 'external', 'images', 'isRepost', 'segments', 'uri', 'url']
const HANDLE = 'mass.masstar.org'

test('Bluesky feed (real response)', () => {
  const posts = normalizeFeed(json('bluesky-feed.json'), HANDLE)
  assert.equal(posts.length, 6)
  for (const p of posts) {
    assert.deepEqual(Object.keys(p).sort(), POST_KEYS)
    assert.match(p.url, /^https:\/\/bsky\.app\/profile\/[^/]+\/post\/[a-z0-9]+$/)
    for (const s of p.segments) if (s.href) assert.match(s.href, /^https:\/\//)
  }

  const first = posts[0]
  assert.equal(first.url, 'https://bsky.app/profile/mass.masstar.org/post/3ldbrsc7tbp2n')
  assert.equal(first.createdAt, '2024-12-14T17:04:25.063Z')
  assert.equal(first.isRepost, false)
  assert.equal(first.segments.length, 1)
  assert.match(first.segments[0].text, /^Good morning everyone!!\n/)
  assert.equal(first.images.length, 1)
  assert.match(first.images[0].thumb, /^https:\/\/cdn\.bsky\.app\/img\/feed_thumbnail\//)
  assert.match(first.images[0].full, /^https:\/\/cdn\.bsky\.app\/img\/feed_fullsize\//)
  assert.deepEqual(first.counts, { likes: 1, reposts: 0, replies: 0 })

  const mentions = posts.find((p) => p.uri.endsWith('/3l6xqlemj4w2t'))
  assert.ok(mentions.external?.uri.startsWith('https://'))
  assert.ok(mentions.segments.filter((s) => s.href?.startsWith('https://bsky.app/profile/did:')).length >= 5)

  const link = posts.find((p) => p.uri.endsWith('/3l6vjykq5dl2c'))
  assert.ok(link.segments.some((s) => s.href && !s.href.startsWith('https://bsky.app/')))

  const tags = posts.find((p) => p.uri.endsWith('/3l6r2bb6jp42d'))
  assert.equal(tags.segments.filter((s) => s.href?.startsWith('https://bsky.app/hashtag/')).length, 3)

  const repost = posts.find((p) => p.uri.endsWith('/3l6qhx52gg22g'))
  assert.equal(repost.isRepost, true)
  assert.notEqual(repost.author.handle, HANDLE)

  const plain = posts.find((p) => p.uri.endsWith('/3l6olm3vbsm27'))
  assert.deepEqual([plain.images, plain.external], [[], null])
})

test('Bluesky facets slice UTF-8 bytes (emoji before a link), unsafe links become text', () => {
  const posts = normalizeFeed(json('bluesky-facets.json'), HANDLE)
  assert.equal(posts.length, 3, 'duplicate uri is dropped')
  assert.deepEqual(posts[0].segments, [
    { text: '\u{1F525}\u{1F3AE} Going live soon! ' },
    { text: 'https://twitch.tv/masstarvt', href: 'https://twitch.tv/masstarvt' },
    { text: ' with ' },
    { text: '@friend.bsky.social', href: 'https://bsky.app/profile/did:plc:friend0000000000000000' },
    { text: ' ' },
    { text: '#VTuber', href: 'https://bsky.app/hashtag/VTuber' },
    { text: ' — also a sneaky link and http://plain.example ✨' },
  ])
  assert.equal(posts[0].segments.map((s) => s.text).join(''), json('bluesky-facets.json').feed[0].post.record.text)
  // recordWithMedia → its images; the javascript: image is dropped
  assert.deepEqual(posts[0].images, [{
    thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:testauthor000000000000/img1@jpeg',
    full: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:testauthor000000000000/img1@jpeg',
    alt: 'Stream overlay',
  }])
  assert.deepEqual(posts[0].counts, { likes: 12, reposts: 3, replies: 2 })

  const repost = posts[1]
  assert.equal(repost.isRepost, true)
  assert.equal(repost.url, 'https://bsky.app/profile/friend.bsky.social/post/3bbbbbbbbbbbb')
  assert.deepEqual(repost.author, { handle: 'friend.bsky.social', displayName: 'friend.bsky.social', avatar: null })
  assert.deepEqual(repost.external, { uri: 'https://example.com/setup', title: 'Streaming setups', description: 'A guide', thumb: 'https://cdn.bsky.app/img/external/thumb@jpeg' })

  // out-of-range and overlapping facets are skipped, invalid DID mention is plain text, javascript: external dropped
  assert.deepEqual(posts[2].segments, [{ text: 'Broken', href: 'https://first.example' }, { text: ' facets \u{1F600} still render' }])
  assert.equal(posts[2].external, null)
  assert.deepEqual(posts[2].counts, { likes: 0, reposts: 0, replies: 0 })
})

test('facetSegments edge cases', () => {
  assert.deepEqual(facetSegments('', []), [])
  assert.deepEqual(facetSegments('plain', undefined), [{ text: 'plain' }])
  const text = 'é #tag'
  const bytes = new TextEncoder().encode('é ').length
  assert.deepEqual(facetSegments(text, [{ index: { byteStart: bytes, byteEnd: bytes + 4 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }] }]), [
    { text: 'é ' }, { text: '#tag', href: 'https://bsky.app/hashtag/tag' },
  ])
})

test('safeHttps', () => {
  assert.equal(safeHttps('https://a.example/x'), 'https://a.example/x')
  assert.equal(safeHttps('http://a.example'), null)
  assert.equal(safeHttps('javascript:alert(1)'), null)
  assert.equal(safeHttps('not a url'), null)
  assert.equal(safeHttps(undefined), null)
})

test('normalizeFeed respects limit; empty/invalid input', () => {
  assert.equal(normalizeFeed(json('bluesky-feed.json'), HANDLE, { limit: 2 }).length, 2)
  assert.deepEqual(normalizeFeed({}, HANDLE), [])
  assert.deepEqual(normalizeFeed({ feed: [{ post: { uri: 'https://nope' } }] }, HANDLE), [])
})

test('Bluesky profile (real response)', () => {
  const p = normalizeProfile(json('bluesky-profile.json'))
  assert.deepEqual(Object.keys(p).sort(), ['avatar', 'displayName'])
  assert.match(p.displayName, /^Mass/)
  assert.match(p.avatar, /^https:\/\/cdn\.bsky\.app\/img\/avatar\//)
  assert.deepEqual(normalizeProfile({ handle: 'x.bsky.social' }), { displayName: 'x.bsky.social', avatar: null })
  assert.throws(() => normalizeProfile({ error: 'InvalidRequest' }))
})
