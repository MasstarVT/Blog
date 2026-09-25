import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseXPostUrl, parseOEmbed, normalizeApiTweets, parseMonthDate, htmlToText, linkPost,
} from '../../src/lib/normalize/x.mjs'

const json = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const XPOST_KEYS = ['authorHandle', 'authorName', 'createdAt', 'id', 'richness', 'text', 'url']

test('parseXPostUrl accepts x.com / twitter.com status URLs and strips the query', () => {
  assert.deepEqual(parseXPostUrl('https://x.com/MasstarVT/status/1234567890?s=20&t=abc'), { id: '1234567890', handle: 'MasstarVT', url: 'https://x.com/MasstarVT/status/1234567890' })
  assert.deepEqual(parseXPostUrl('https://twitter.com/MasstarVT/status/42/photo/1'), { id: '42', handle: 'MasstarVT', url: 'https://x.com/MasstarVT/status/42' })
  assert.deepEqual(parseXPostUrl('https://mobile.twitter.com/a_b/statuses/7#frag'), { id: '7', handle: 'a_b', url: 'https://x.com/a_b/status/7' })
  // Handle-less forms map to /i/status/<id>: oEmbed answers /i/web/status/ with 404 (read as "deleted").
  assert.deepEqual(parseXPostUrl('https://x.com/i/web/status/99'), { id: '99', handle: null, url: 'https://x.com/i/status/99' })
  assert.deepEqual(parseXPostUrl('https://twitter.com/i/status/98?s=20'), { id: '98', handle: null, url: 'https://x.com/i/status/98' })
  assert.equal(parseXPostUrl('https://x.com/MasstarVT'), null)
  assert.equal(parseXPostUrl('https://evil.com/MasstarVT/status/1'), null)
  assert.equal(parseXPostUrl('javascript:alert(1)'), null)
  assert.equal(parseXPostUrl(''), null)
})

test('parseOEmbed (real response) extracts plain text only', () => {
  const url = 'https://twitter.com/Interior/status/463440424141459456?ref_src=twsrc'
  const post = parseOEmbed(json('x-oembed.json'), url)
  assert.deepEqual(Object.keys(post).sort(), XPOST_KEYS)
  assert.deepEqual(post, {
    id: '463440424141459456',
    url: 'https://x.com/Interior/status/463440424141459456',
    createdAt: '2014-05-05',
    text: "Sunsets don't get much better than this one over @GrandTetonNPS. #nature #sunset pic.twitter.com/YuKy2rcjyU",
    authorName: 'U.S. Department of the Interior',
    authorHandle: 'Interior',
    richness: 'oembed',
  })
  assert.ok(!/[<>]/.test(post.text), 'no HTML survives')
})

test('parseOEmbed handles <br>, entities and the handle from the byline', () => {
  const html = '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Line one<br>Line &amp; two<br/>&#128293; <a href="https://t.co/x">link</a></p>&mdash; Mass (@MasstarVT) <a href="https://twitter.com/MasstarVT/status/5?ref_src=twsrc%5Etfw">January 31, 2026</a></blockquote>'
  const post = parseOEmbed({ html, author_name: 'Mass', author_url: 'not-a-profile' }, 'https://x.com/i/web/status/5')
  assert.equal(post.text, 'Line one\nLine & two\n\u{1F525} link')
  assert.equal(post.authorHandle, 'MasstarVT')
  assert.equal(post.url, 'https://x.com/MasstarVT/status/5')
  assert.equal(post.createdAt, '2026-01-31')
  assert.throws(() => parseOEmbed({ html }, 'https://example.com/'), /not a post URL/)
})

test('parseMonthDate / htmlToText', () => {
  assert.equal(parseMonthDate('May 5, 2014'), '2014-05-05')
  assert.equal(parseMonthDate('February 30, 2026'), null)
  assert.equal(parseMonthDate('Smarch 1, 2026'), null)
  assert.equal(htmlToText('<p>a<br />b &lt;tag&gt;</p>'), 'a\nb <tag>')
})

test('linkPost keeps only the link', () => {
  const p = linkPost(parseXPostUrl('https://x.com/i/web/status/9'), 'MasstarVT')
  assert.deepEqual(p, { id: '9', url: 'https://x.com/MasstarVT/status/9', createdAt: null, text: null, authorName: null, authorHandle: 'MasstarVT', richness: 'link' })
})

test('normalizeApiTweets', () => {
  const posts = normalizeApiTweets(json('x-api-tweets.json'), 'MasstarVT', { authorName: 'MasstarVT' })
  assert.equal(posts.length, 2)
  for (const p of posts) assert.deepEqual(Object.keys(p).sort(), XPOST_KEYS)
  assert.deepEqual(posts[0], {
    id: '1970000000000000002',
    url: 'https://x.com/MasstarVT/status/1970000000000000002',
    createdAt: '2026-09-24T20:15:00.000Z',
    text: 'Going live in 10! Q&A + games > sleep https://t.co/abc123',
    authorName: 'MasstarVT',
    authorHandle: 'MasstarVT',
    richness: 'api',
  })
  assert.equal(posts[1].text, 'New schedule is up \u{1F4C5}')
  assert.equal(normalizeApiTweets(json('x-api-tweets.json'), 'MasstarVT', { limit: 1 }).length, 1)
  assert.deepEqual(normalizeApiTweets({ meta: { result_count: 0 } }, 'MasstarVT'), [])
  assert.throws(() => normalizeApiTweets({}, 'bad handle!'))
})
