import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  parseArgs, stableStringify, dataHash, parseFrontmatter, postsHash, fetchAll, writeFiles,
} from '../fetch-data.mjs'
import { site as realSite } from '../../src/config/site.mjs'
import { defaults } from '../../src/data/defaults.mjs'

const run = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../fetch-data.mjs', import.meta.url))
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const NOW = new Date('2026-10-25T12:00:00Z')
const NAMES = ['twitch', 'discord', 'bluesky', 'youtube', 'x']

function assertShape(actual, expected, path = '') {
  for (const [k, v] of Object.entries(expected)) {
    assert.ok(actual && k in actual, `${path}${k} missing`)
    if (Array.isArray(v)) assert.ok(Array.isArray(actual[k]), `${path}${k} should be an array`)
    else if (v && typeof v === 'object' && Object.keys(v).length) assertShape(actual[k], v, `${path}${k}.`)
    else if (typeof v === 'boolean') assert.equal(typeof actual[k], 'boolean', `${path}${k} should be boolean`)
  }
}

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

// A child env without any real credentials or CI summary file.
const cleanEnv = (extra) => ({
  ...process.env,
  TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', X_API_KEY: '', X_API_SECRET: '', X_ACCESS_TOKEN: '', X_ACCESS_SECRET: '',
  YOUTUBE_API_KEY: '', GITHUB_STEP_SUMMARY: '', PREVIOUS_DATA_URL: 'http://127.0.0.1:9/never',
  ...extra,
})

test('parseArgs', () => {
  assert.deepEqual(parseArgs([]), { ifMissing: false, only: null, offline: false, saveRaw: false, strict: false })
  assert.deepEqual(parseArgs(['--if-missing', '--offline', '--save-raw', '--strict', '--only=Twitch, x']), {
    ifMissing: true, only: ['twitch', 'x'], offline: true, saveRaw: true, strict: true,
  })
  assert.deepEqual(parseArgs(['--only', 'bluesky']).only, ['bluesky'])
  assert.throws(() => parseArgs(['--only=tiktok']), /--only/)
  assert.throws(() => parseArgs(['--only=']), /--only/)
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/)
})

test('stableStringify ignores key order', () => {
  assert.equal(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}')
  assert.equal(stableStringify({ a: undefined, b: 1 }), '{"b":1}')
})

test('dataHash ignores fetchedAt/status/staleSince and volatile counters only', () => {
  const files = Object.fromEntries(NAMES.map((n) => [n, structuredClone(defaults[n])]))
  const h = dataHash(files)
  const touched = structuredClone(files)
  touched.discord.fetchedAt = '2026-01-01T00:00:00.000Z'
  touched.discord.status = 'stale'
  touched.discord.staleSince = '2025-01-01T00:00:00.000Z'
  touched.discord.online = 99
  touched.twitch.live.viewers = 12
  touched.twitch.status = { user: 'ok' }
  touched.twitch.partFetchedAt = { user: '2026-01-01T00:00:00.000Z' }
  assert.equal(dataHash(touched), h)
  // a missing file hashes like its default shape (that is what the site renders)
  const { x, ...withoutX } = files
  assert.equal(dataHash(withoutX), h)
  const reordered = Object.fromEntries(Object.entries(files).reverse())
  assert.equal(dataHash(reordered), h)
  const changed = structuredClone(files)
  changed.discord.members = 49
  assert.notEqual(dataHash(changed), h)
  const live = structuredClone(files)
  live.twitch.live.isLive = true
  assert.notEqual(dataHash(live), h)
})

test('parseFrontmatter (tiny YAML subset)', () => {
  const fm = parseFrontmatter([
    '---',
    "title: 'It''s \"here\"' # comment",
    'description: "A \\"quoted\\" line"',
    'pubDate: 2026-09-25',
    'draft: true',
    "tags: ['a', b]",
    'list:',
    '  - one',
    '  - two',
    'count: 3 # trailing',
    'empty:',
    '---',
    'body: not frontmatter',
  ].join('\r\n'))
  assert.deepEqual(fm, {
    title: 'It\'s "here"', description: 'A "quoted" line', pubDate: '2026-09-25', draft: true,
    tags: ['a', 'b'], list: ['one', 'two'], count: 3, empty: null,
  })
  assert.deepEqual(parseFrontmatter('no frontmatter'), {})
})

test('postsHash: sorted ids of published posts only', async () => {
  const dir = await tempDir('posts-')
  try {
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(join(dir, 'b-post.md'), '---\ntitle: B\npubDate: 2026-01-01\n---\nbody')
    await writeFile(join(dir, 'nested', 'c.mdx'), '---\ntitle: C\npubDate: "2026-10-25T11:00:00Z"\ndraft: false\n---\n')
    await writeFile(join(dir, 'draft.md'), '---\ntitle: D\npubDate: 2026-01-01\ndraft: true\n---\n')
    await writeFile(join(dir, 'future.md'), '---\ntitle: F\npubDate: 2026-12-01\n---\n')
    await writeFile(join(dir, '_hidden.md'), '---\ntitle: H\n---\n')
    await writeFile(join(dir, 'notes.txt'), 'ignored')
    assert.equal(await postsHash(dir, NOW), sha256('b-post\nnested/c'))
    // the scheduled post becomes part of the hash once its date passes
    assert.equal(await postsHash(dir, new Date('2026-12-02T00:00:00Z')), sha256('b-post\nfuture\nnested/c'))
    assert.equal(await postsHash(join(dir, 'missing'), NOW), sha256(''))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function fixtureFetch() {
  const routes = [
    ['https://api.ivr.fi/v2/twitch/user', () => fixture('ivr-user-offline.json')],
    ['https://api.twitch.tv/helix/schedule/icalendar', () => fixture('twitch-ical-dst.ics')],
    ['https://discord.com/api/v10/invites/', () => fixture('discord-invite.json')],
    ['https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed', () => fixture('bluesky-feed.json')],
    ['https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile', () => fixture('bluesky-profile.json')],
  ]
  const calls = []
  const fetch = async (url) => {
    calls.push(url)
    const route = routes.find(([prefix]) => url.startsWith(prefix))
    return route ? new Response(route[1](), { status: 200 }) : new Response('not found', { status: 404 })
  }
  return { fetch, calls }
}

test('fetchAll end to end with fixture responses', async () => {
  const root = await tempDir('root-')
  const dir = join(root, 'generated')
  try {
    await mkdir(join(root, 'src', 'data'), { recursive: true })
    await mkdir(join(root, 'src', 'content', 'posts'), { recursive: true })
    await writeFile(join(root, 'src', 'data', 'x-posts.json'), '{"posts":[]}')
    await writeFile(join(root, 'src', 'content', 'posts', 'hello.md'), '---\ntitle: Hello\npubDate: 2026-09-01\n---\n')
    const { fetch, calls } = fixtureFetch()
    const { files, rows, raw } = await fetchAll({ fetch, env: {}, now: NOW, dir, root, site: realSite, saveRaw: true, httpOptions: { backoffMs: 1 } })

    for (const name of NAMES) assertShape(files[name], defaults[name])
    assert.deepEqual(rows.map((r) => `${r.source}${r.part ? `/${r.part}` : ''}=${r.status}`), [
      'twitch/user=ok', 'twitch/live=ok', 'twitch/schedule=ok', 'twitch/videos=skipped:no-credentials', 'twitch/clips=skipped:no-credentials',
      'discord=ok', 'bluesky=ok', 'youtube=skipped:not-configured', 'x=skipped:not-configured',
    ])
    assert.equal(files.twitch.schedule.segments.length, 9)
    assert.equal(files.bluesky.posts.length, 5)
    assert.equal(files.x.source, 'none')
    assert.deepEqual(Object.keys(files.meta), ['builtAt', 'hash', 'postsHash', 'sources', 'commit'])
    assert.equal(files.meta.builtAt, NOW.toISOString())
    assert.match(files.meta.hash, /^[0-9a-f]{64}$/)
    assert.equal(files.meta.postsHash, sha256('hello'))
    assert.equal(files.meta.sources.discord, 'ok')
    assert.ok(raw.some(([label]) => label === 'discord-invite'))
    assert.ok(calls.includes('https://blog.masstar.org/data/twitch.json'), 'previous deployed data looked up')

    await writeFiles(dir, files)
    for (const name of [...NAMES, 'meta']) {
      const text = await readFile(join(dir, `${name}.json`), 'utf8')
      assert.ok(text.endsWith('}\n') && !text.includes('\r'), `${name}.json is pretty JSON with LF`)
      assert.deepEqual(JSON.parse(text), files[name])
    }

    // --only keeps the other files from the previous run; hash is stable for identical data;
    // rows (table, warnings, --strict) cover the selected source only
    const again = await fetchAll({ fetch, env: {}, now: new Date(NOW.getTime() + 60_000), dir, root, site: realSite, only: ['discord'] })
    assert.deepEqual(again.files.bluesky, files.bluesky)
    assert.equal(again.files.meta.hash, files.meta.hash)
    assert.deepEqual(again.rows.map((r) => [r.source, r.status]), [['discord', 'ok']])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('--only without previous data writes only the selected files and reports only them', async () => {
  const root = await tempDir('root-')
  const dir = join(root, 'generated')
  try {
    await mkdir(join(root, 'src', 'data'), { recursive: true })
    const { fetch } = fixtureFetch()
    const { files, rows } = await fetchAll({ fetch, env: { PREVIOUS_DATA_URL: 'http://127.0.0.1:9/never' }, now: NOW, dir, root, site: realSite, only: ['discord'], httpOptions: { backoffMs: 1 } })
    assert.deepEqual(Object.keys(files).sort(), ['discord', 'meta'])
    assert.deepEqual(rows.map((r) => [r.source, r.status]), [['discord', 'ok']])
    assert.deepEqual(files.meta.sources, { discord: 'ok' })
    await writeFiles(dir, files)
    await assert.rejects(stat(join(dir, 'twitch.json')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('youtube configured but unreachable: the fallback still says configured', async () => {
  const root = await tempDir('root-')
  try {
    const site = { ...realSite, youtube: { channelId: 'UCtestchannel0000000000', handle: null } }
    const { files } = await fetchAll({ offline: true, env: {}, now: NOW, dir: join(root, 'generated'), root, site, only: ['youtube'] })
    assert.deepEqual(files.youtube, { ...defaults.youtube, configured: true, channelUrl: 'https://www.youtube.com/channel/UCtestchannel0000000000', status: 'empty' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CLI --only --strict judges the selected sources only and writes no placeholders', async () => {
  const dir = await tempDir('gen-')
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, '--offline', '--only=youtube', '--strict'], { env: cleanEnv({ GENERATED_DIR: dir }) })
    assert.match(stdout, /youtube\s+skipped:not-configured/)
    assert.doesNotMatch(stdout, /twitch|discord|bluesky|::warning/)
    assert.match(stdout, /::notice title=fetch-data youtube::youtube is skipped:not-configured/)
    await assert.rejects(stat(join(dir, 'twitch.json')), { code: 'ENOENT' })
    // so a later --if-missing (predev/prebuild) still fetches instead of skipping
    const { stdout: second } = await run(process.execPath, [SCRIPT, '--if-missing', '--offline'], { env: cleanEnv({ GENERATED_DIR: dir }) })
    assert.doesNotMatch(second, /already present/)
    await stat(join(dir, 'twitch.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI --offline with no previous data writes the default shapes', async () => {
  const dir = await tempDir('gen-')
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, '--offline'], { env: cleanEnv({ GENERATED_DIR: dir }) })
    assert.match(stdout, /twitch\/user\s+empty/)
    assert.match(stdout, /youtube\s+skipped:not-configured/)
    assert.match(stdout, /::warning title=fetch-data discord::discord is empty \(offline: https:\/\/discord\.com/)
    const files = Object.fromEntries(await Promise.all([...NAMES, 'meta'].map(async (n) => [n, JSON.parse(await readFile(join(dir, `${n}.json`), 'utf8'))])))
    for (const name of NAMES) assertShape(files[name], defaults[name])
    assert.deepEqual(files.twitch.status, { user: 'empty', live: 'empty', schedule: 'empty', videos: 'skipped:no-credentials', clips: 'skipped:no-credentials' })
    assert.deepEqual(files.discord, { ...defaults.discord, status: 'empty' })
    assert.deepEqual(files.bluesky, { ...defaults.bluesky, status: 'empty' })
    assert.deepEqual(files.youtube, { ...defaults.youtube, status: 'skipped:not-configured' })
    assert.deepEqual(files.x, { ...defaults.x, status: 'skipped:not-configured' })
    assert.match(files.meta.hash, /^[0-9a-f]{64}$/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI --offline reuses previous data as stale; --strict fails; --if-missing skips', async () => {
  const dir = await tempDir('gen-')
  try {
    const prevDiscord = { ...defaults.discord, fetchedAt: '2026-09-01T00:00:00.000Z', status: 'ok', name: "Mass's Hideout", members: 48, online: 18 }
    await writeFile(join(dir, 'discord.json'), JSON.stringify(prevDiscord))
    const { stdout } = await run(process.execPath, [SCRIPT, '--offline', '--only=discord'], { env: cleanEnv({ GENERATED_DIR: dir }) })
    assert.match(stdout, /discord\s+stale/)
    const discord = JSON.parse(await readFile(join(dir, 'discord.json'), 'utf8'))
    assert.deepEqual(discord, { ...prevDiscord, status: 'stale', staleSince: '2026-09-01T00:00:00.000Z' })

    await assert.rejects(run(process.execPath, [SCRIPT, '--offline', '--strict'], { env: cleanEnv({ GENERATED_DIR: dir }) }), (err) => err.code === 1)

    const before = (await stat(join(dir, 'twitch.json'))).mtimeMs
    const skipped = await run(process.execPath, [SCRIPT, '--if-missing'], { env: cleanEnv({ GENERATED_DIR: dir }) })
    assert.match(skipped.stdout, /already present, skipping/)
    assert.equal((await stat(join(dir, 'twitch.json'))).mtimeMs, before)

    await assert.rejects(run(process.execPath, [SCRIPT, '--bogus'], { env: cleanEnv({ GENERATED_DIR: dir }) }), (err) => err.code === 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
