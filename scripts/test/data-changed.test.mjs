import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { decide, parseArgs, run, MAX_AGE_MS } from '../data-changed.mjs'
import { isEntryModule } from '../lib/run-source.mjs'

const exec = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../data-changed.mjs', import.meta.url))
const NOW = Date.parse('2026-09-25T12:00:00Z')
const META = { builtAt: '2026-09-25T10:00:00.000Z', hash: 'h1', postsHash: 'p1', sources: {} }

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--event', 'schedule', '--force', 'false']), { event: 'schedule', force: false })
  assert.deepEqual(parseArgs(['--event=workflow_dispatch', '--force=true']), { event: 'workflow_dispatch', force: true })
  assert.deepEqual(parseArgs(['--force', '']), { event: '', force: false })
  assert.deepEqual(parseArgs([]), { event: '', force: false })
})

test('decision table', () => {
  const rows = [
    [{ event: 'push', force: false }, true, 'event:push'],
    [{ event: 'workflow_dispatch', force: false }, true, 'event:workflow_dispatch'],
    [{ event: '', force: false }, true, 'event:unknown'],
    [{ event: 'schedule', force: true, local: META, previous: META }, true, 'forced'],
    [{ event: 'schedule', force: false, local: null, previous: META }, true, 'local-meta-missing'],
    [{ event: 'schedule', force: false, local: META, previous: null }, true, 'previous-meta-missing'],
    [{ event: 'schedule', force: false, local: META, previous: { ...META, hash: 'h0' } }, true, 'data-changed'],
    [{ event: 'schedule', force: false, local: META, previous: { ...META, postsHash: 'p0' } }, true, 'posts-changed'],
    [{ event: 'schedule', force: false, local: META, previous: { ...META, builtAt: new Date(NOW - MAX_AGE_MS - 1).toISOString() } }, true, 'max-age'],
    [{ event: 'schedule', force: false, local: META, previous: { ...META, builtAt: 'garbage' } }, true, 'max-age'],
    [{ event: 'schedule', force: false, local: META, previous: { ...META, builtAt: new Date(NOW - MAX_AGE_MS + 1000).toISOString() } }, false, 'unchanged'],
    [{ event: 'schedule', force: false, local: META, previous: META }, false, 'unchanged'],
  ]
  for (const [input, deploy, reason] of rows) {
    assert.deepEqual(decide({ now: NOW, ...input }), { deploy, reason }, JSON.stringify(input))
  }
})

test('run(): reads local meta, fetches deployed meta, never throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-'))
  try {
    const env = { PREVIOUS_DATA_URL: 'https://deployed.example/data/' }
    const argv = ['--event', 'schedule', '--force', 'false']
    const serve = (body, status = 200) => async (url) => {
      assert.equal(url, 'https://deployed.example/data/meta.json')
      return new Response(JSON.stringify(body), { status })
    }

    assert.deepEqual(await run({ argv, env, dir, now: NOW, fetch: serve(META) }), { deploy: true, reason: 'local-meta-missing' })
    await writeFile(join(dir, 'meta.json'), JSON.stringify(META))
    assert.deepEqual(await run({ argv, env, dir, now: NOW, fetch: serve(META) }), { deploy: false, reason: 'unchanged' })
    assert.deepEqual(await run({ argv, env, dir, now: NOW, fetch: serve({ ...META, hash: 'x' }) }), { deploy: true, reason: 'data-changed' })
    assert.deepEqual(await run({ argv, env, dir, now: NOW, fetch: serve({}, 404) }), { deploy: true, reason: 'previous-meta-missing' })
    const down = async () => { throw new TypeError('fetch failed') }
    assert.deepEqual(await run({ argv, env, dir, now: NOW, fetch: down }), { deploy: true, reason: 'previous-meta-missing' })

    let fetched = false
    const spy = async () => { fetched = true; return new Response('{}') }
    assert.deepEqual(await run({ argv: ['--event', 'push'], env, dir, fetch: spy }), { deploy: true, reason: 'event:push' })
    assert.equal(fetched, false, 'push never needs the network')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI prints deploy/reason lines for $GITHUB_OUTPUT', async () => {
  const { stdout } = await exec(process.execPath, [SCRIPT, '--event', 'push', '--force', 'false'])
  assert.equal(stdout.replace(/\r\n/g, '\n'), 'deploy=true\nreason=event:push\n')
})

test('CLIs still run when started through a symlink or junction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'link-'))
  try {
    const scripts = fileURLToPath(new URL('..', import.meta.url))
    const link = join(dir, 'scripts')
    await symlink(scripts, link, 'junction') // a junction on Windows (no admin needed), a symlink elsewhere
    const linked = join(link, 'data-changed.mjs')
    const { stdout } = await exec(process.execPath, [linked, '--event', 'push', '--force', 'false'])
    assert.equal(stdout.replace(/\r\n/g, '\n'), 'deploy=true\nreason=event:push\n')

    // the fallback used when import.meta.main is unavailable resolves the link too
    assert.equal(isEntryModule(new URL('../data-changed.mjs', import.meta.url).href, linked), true)
    assert.equal(isEntryModule(new URL('../fetch-data.mjs', import.meta.url).href, linked), false)
    assert.equal(isEntryModule(new URL('../data-changed.mjs', import.meta.url).href, undefined), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('decide: redeploys when the live site was built from a different commit', () => {
  const base = { hash: 'h', postsHash: 'p', builtAt: new Date(Date.now() - 60_000).toISOString() }
  assert.deepEqual(
    decide({ event: 'schedule', force: false, local: { ...base, commit: 'b' }, previous: { ...base, commit: 'a' } }),
    { deploy: true, reason: 'code-changed' },
  )
  // local runs have no commit, so they never force a deploy on that basis
  assert.deepEqual(
    decide({ event: 'schedule', force: false, local: { ...base, commit: null }, previous: { ...base, commit: 'a' } }),
    { deploy: false, reason: 'unchanged' },
  )
})
