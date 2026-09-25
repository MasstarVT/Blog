#!/usr/bin/env node
// Fetch every social source into src/data/generated/*.json (the contract is src/data/defaults.mjs).
// Each part falls back on its own: fresh → previously deployed (stale) → empty default, so a
// failing API never breaks the build.
//
//   node scripts/fetch-data.mjs [--if-missing] [--only=twitch,bluesky] [--offline] [--save-raw] [--strict]
//
// Secrets come from the environment only: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, X_API_KEY,
// X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET, YOUTUBE_API_KEY. GENERATED_DIR overrides the
// output directory; PREVIOUS_DATA_URL the deployed data used as fallback.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { site as siteConfig } from '../src/config/site.mjs'
import { defaults } from '../src/data/defaults.mjs'
import { createHttp } from './lib/http.mjs'
import { ROOT, generatedDir, isEntryModule, loadPrevious, previousDataUrl, runPart } from './lib/run-source.mjs'
import { SOURCES, collectRows, formatTable, isAcceptable, markdownSummary, sourceSummaries, warningLines } from './lib/summary.mjs'
import { buildTwitch } from './lib/sources/twitch.mjs'
import { fetchDiscord } from './lib/sources/discord.mjs'
import { fetchBluesky } from './lib/sources/bluesky.mjs'
import { fetchYouTube, youtubeDefaults } from './lib/sources/youtube.mjs'
import { fetchX } from './lib/sources/x.mjs'

export function parseArgs(argv) {
  const opts = { ifMissing: false, only: null, offline: false, saveRaw: false, strict: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--if-missing') opts.ifMissing = true
    else if (arg === '--offline') opts.offline = true
    else if (arg === '--save-raw') opts.saveRaw = true
    else if (arg === '--strict') opts.strict = true
    else if (arg.startsWith('--only=') || arg === '--only') {
      const value = arg === '--only' ? argv[++i] ?? '' : arg.slice('--only='.length)
      opts.only = value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (opts.only) {
    const unknown = opts.only.filter((n) => !SOURCES.includes(n))
    if (unknown.length || !opts.only.length) throw new Error(`--only expects a comma list of: ${SOURCES.join(', ')}`)
  }
  return opts
}

// ---------------------------------------------------------------------------------------------
// meta.json

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** JSON with object keys sorted at every level, so the hash ignores key order. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// Bookkeeping, not content. partFetchedAt is twitch.json's per-part fetchedAt.
const HASH_STRIP = ['fetchedAt', 'status', 'staleSince', 'partFetchedAt']
// DELIBERATE DEVIATION from "strip only fetchedAt/status/staleSince": counters that change on
// almost every run are left out too. The workflow runs every 30 minutes; with these in the hash
// nearly every scheduled run would redeploy. Trade-off: the build-time Discord online count and
// Twitch viewer count (the latter is polled live in the browser anyway) can lag up to the gate's
// 6h max age. Empty this map to follow the spec to the letter.
const VOLATILE = { twitch: [['live', 'viewers']], discord: [['online']] }

/**
 * sha256 of all data files minus bookkeeping fields and volatile counters. A missing file counts
 * as its default shape, which is what the site renders for it.
 */
export function dataHash(files) {
  const clean = {}
  for (const name of SOURCES) {
    const f = structuredClone(files[name] ?? defaults[name])
    for (const k of HASH_STRIP) delete f[k]
    for (const path of VOLATILE[name] ?? []) {
      const parent = path.slice(0, -1).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), f)
      if (parent && typeof parent === 'object') delete parent[path[path.length - 1]]
    }
    clean[name] = f
  }
  return sha256(stableStringify(clean))
}

function parseYamlScalar(raw) {
  const v = raw.trim()
  if (v.startsWith("'")) return v.slice(1, v.lastIndexOf("'") > 0 ? v.lastIndexOf("'") : undefined).replace(/''/g, "'")
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"')
    return v.slice(1, end > 0 ? end : undefined).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n')
  }
  const plain = v.replace(/\s+#.*$/, '').trim()
  if (/^(?:true|yes)$/i.test(plain)) return true
  if (/^(?:false|no)$/i.test(plain)) return false
  if (/^(?:null|~)?$/i.test(plain)) return null
  if (/^-?\d+(?:\.\d+)?$/.test(plain)) return Number(plain)
  if (plain.startsWith('[') && plain.endsWith(']')) {
    return plain.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).map(parseYamlScalar)
  }
  return plain
}

/** Minimal YAML frontmatter reader: top-level `key: value` pairs, inline and dash lists. */
export function parseFrontmatter(text) {
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(text ?? ''))
  if (!m) return {}
  const data = {}
  let listKey = null
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? (listKey ? /^-\s+(.*)$/.exec(line) : null)
    if (item && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = []
      data[listKey].push(parseYamlScalar(item[1]))
      continue
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line)
    if (!kv) continue
    const value = kv[2].trim()
    data[kv[1]] = value === '' ? null : parseYamlScalar(value)
    listKey = value === '' ? kv[1] : null
  }
  return data
}

async function listPostFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { recursive: true })
  } catch {
    return []
  }
  return entries
    .filter((p) => /\.mdx?$/i.test(p) && !basename(p).startsWith('_'))
    .map((p) => join(dir, p))
}

/** sha256 of the sorted ids of published posts (draft !== true and pubDate <= now). */
export async function postsHash(postsDir, now = new Date()) {
  const nowMs = new Date(now).getTime()
  const ids = []
  for (const file of await listPostFiles(postsDir)) {
    const fm = parseFrontmatter(await readFile(file, 'utf8'))
    if (fm.draft === true) continue
    const pub = Date.parse(fm.pubDate ?? '')
    if (!Number.isNaN(pub) && pub > nowMs) continue
    ids.push(relative(postsDir, file).split(sep).join('/').replace(/\.mdx?$/i, ''))
  }
  return sha256(ids.sort().join('\n'))
}

// ---------------------------------------------------------------------------------------------
// Orchestration

/**
 * Fetch the selected sources (all by default) and build every generated file in memory.
 * Everything is injectable for tests: fetch, env, now, site, output dir, repo root.
 * Returns { files: { twitch, discord, bluesky, youtube, x, meta }, rows, errors, raw }.
 */
export async function fetchAll({
  fetch = globalThis.fetch, env = process.env, now = new Date(), only = null, offline = false, saveRaw = false,
  dir = generatedDir(env), root = ROOT, site = siteConfig, httpOptions = {},
} = {}) {
  const nowDate = new Date(now)
  const http = createHttp({ fetch, offline, ...httpOptions })
  const baseUrl = previousDataUrl(env)
  const selected = only ?? SOURCES

  const prevs = Object.fromEntries(await Promise.all(
    SOURCES.map(async (name) => [name, await loadPrevious(name, { dir, baseUrl, fetch, offline })]),
  ))

  const errors = {}
  const report = ({ name, error }) => {
    if (error) errors[name] = error
  }
  const raw = []
  const ctx = { http, env, site, now: nowDate, report, raw: saveRaw ? (label, body) => raw.push([label, body]) : () => {} }
  const part = (name, fn, def = defaults[name]) => runPart(name, fn, prevs[name], def, { now: nowDate, report })

  const run = {
    twitch: () => buildTwitch({ ...ctx, prev: prevs.twitch, def: defaults.twitch }),
    discord: () => part('discord', () => fetchDiscord(ctx)),
    bluesky: () => part('bluesky', () => fetchBluesky(ctx)),
    youtube: () => part('youtube', () => fetchYouTube(ctx), youtubeDefaults(site, defaults.youtube)),
    x: () => part('x', () => fetchX({ ...ctx, curatedFile: join(root, 'src', 'data', 'x-posts.json') })),
  }

  // Unselected sources (--only) keep their previous file untouched; without one nothing is
  // written, so a default-shaped placeholder never masks missing data (e.g. for --if-missing).
  const files = {}
  await Promise.all(SOURCES.map(async (name) => {
    const data = selected.includes(name) ? await run[name]() : prevs[name]
    if (data) files[name] = data
  }))

  files.meta = {
    builtAt: nowDate.toISOString(),
    hash: dataHash(files),
    postsHash: await postsHash(join(root, 'src', 'content', 'posts'), nowDate),
    sources: sourceSummaries(files),
    // Commit the data was built with; lets the scheduled gate redeploy code a skipped/failed run missed
    commit: env.GITHUB_SHA ?? null,
  }
  // Rows (and so the table, ::warning:: lines and --strict) cover the selected sources only.
  const ran = Object.fromEntries(selected.filter((name) => files[name]).map((name) => [name, files[name]]))
  return { files, rows: collectRows(ran, errors), errors, raw }
}

export async function writeFiles(dir, files) {
  await mkdir(dir, { recursive: true })
  for (const name of [...SOURCES, 'meta']) {
    if (files[name]) await writeFile(join(dir, `${name}.json`), `${JSON.stringify(files[name], null, 2)}\n`, 'utf8')
  }
}

async function writeRaw(dir, raw) {
  await mkdir(dir, { recursive: true })
  for (const [label, body] of raw) {
    const isText = typeof body === 'string'
    const file = join(dir, `${label.replace(/[^\w.-]+/g, '_')}.${isText ? 'txt' : 'json'}`)
    await writeFile(file, isText ? body : `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  }
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`fetch-data: ${err.message}`)
    process.exitCode = 2
    return
  }

  const dir = generatedDir()
  if (opts.ifMissing && existsSync(join(dir, 'twitch.json'))) {
    console.log('fetch-data: generated data already present, skipping (run `npm run fetch` to refresh)')
    return
  }

  const started = Date.now()
  const { files, rows, raw } = await fetchAll({ ...opts, dir })
  await writeFiles(dir, files)
  if (opts.saveRaw) await writeRaw(join(ROOT, '.cache', 'raw'), raw)

  console.log(formatTable(rows))
  console.log(`\nfetch-data: wrote ${relative(process.cwd(), dir) || '.'} in ${Date.now() - started}ms${opts.offline ? ' (offline)' : ''}`)
  for (const line of warningLines(rows)) console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdownSummary(rows, files.meta))

  if (opts.strict && rows.some((r) => !isAcceptable(r.status))) {
    console.error('fetch-data: --strict: some parts are not ok')
    process.exitCode = 1
  }
}

// import.meta.main (Node >= 24.2) also works when started through a symlink or junction.
const isMain = import.meta.main ?? isEntryModule(import.meta.url)

if (isMain) {
  main().catch((err) => {
    console.error(`fetch-data: ${err?.stack ?? err}`)
    process.exitCode = 1
  })
}
