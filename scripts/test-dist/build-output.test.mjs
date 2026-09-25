// Sanity checks on the built site (run after `astro build`): the files GitHub Pages needs exist,
// drafts are not published, generated data is valid, and no secret ended up in the output.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))
const read = (p) => readFileSync(join(DIST, p), 'utf8')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    statSync(p).isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}

test('core pages exist', () => {
  for (const p of [
    'index.html', '404.html', 'blog/index.html', 'schedule/index.html', 'links/index.html',
    'tags/index.html', 'rss.xml', 'sitemap-index.xml', 'schedule.ics', 'robots.txt', 'PFP.jpg', 'og-default.jpg',
  ]) {
    assert.ok(existsSync(join(DIST, p)), `missing dist/${p}`)
  }
})

test('drafts and future posts are not published', () => {
  const posts = existsSync(join(DIST, 'blog')) ? readdirSync(join(DIST, 'blog')) : []
  assert.ok(!posts.includes('markdown-kitchen-sink'), 'draft post was published')
  assert.ok(!read('rss.xml').includes('markdown-kitchen-sink'), 'draft post is in the RSS feed')
})

test('generated data endpoints are valid JSON', () => {
  for (const name of ['twitch', 'discord', 'bluesky', 'youtube', 'x', 'meta']) {
    assert.doesNotThrow(() => JSON.parse(read(`data/${name}.json`)), `data/${name}.json is not valid JSON`)
  }
})

test('calendar feed is well-formed', () => {
  const ics = read('schedule.ics')
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
  assert.match(ics, /END:VCALENDAR\r\n$/)
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `unfolded line: ${line}`)
})

test('no secrets in the build output', () => {
  const secrets = ['TWITCH_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'YOUTUBE_API_KEY']
    .map((k) => process.env[k])
    .filter((v) => v && v.length >= 8)
  if (!secrets.length) return
  for (const file of walk(DIST)) {
    if (!/\.(html|js|json|xml|ics|txt|css)$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const s of secrets) assert.ok(!text.includes(s), `a secret value appears in ${file}`)
  }
})
