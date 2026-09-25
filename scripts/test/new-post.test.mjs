import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parseArgs, renderPost, createPost, today } from '../new-post.mjs'
import { parseFrontmatter } from '../fetch-data.mjs'

const exec = promisify(execFile)
const SCRIPT = fileURLToPath(new URL('../new-post.mjs', import.meta.url))
const NOW = new Date(2026, 8, 25, 10, 0, 0) // local time

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['My', 'first', 'post'], NOW), { title: 'My first post', tags: [], draft: false, date: '2026-09-25' })
  assert.deepEqual(parseArgs(['Hello', '--tags', 'stream, vtuber,,stream', '--draft', '--date', '2026-10-01'], NOW), {
    title: 'Hello', tags: ['stream', 'vtuber'], draft: true, date: '2026-10-01',
  })
  assert.deepEqual(parseArgs(['--tags=a,b', 'X'], NOW).tags, ['a', 'b'])
  assert.throws(() => parseArgs([], NOW), /usage/)
  assert.throws(() => parseArgs(['T', '--date', '2026-02-30'], NOW), /real date/)
  assert.throws(() => parseArgs(['T', '--date', '25/09/2026'], NOW), /YYYY-MM-DD/)
  assert.throws(() => parseArgs(['T', '--weird'], NOW), /Unknown option/)
  assert.equal(today(NOW), '2026-09-25')
})

test('renderPost', () => {
  assert.equal(renderPost({ title: "Mass's big day", tags: ['a', "b'c"], draft: true, date: '2026-09-25' }), [
    '---',
    "title: 'Mass''s big day'",
    "description: ''",
    'pubDate: 2026-09-25',
    "tags: ['a', 'b''c']",
    'draft: true',
    '---',
    '',
    '',
  ].join('\n'))
})

test('createPost writes a parseable file and refuses to overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'posts-'))
  try {
    const opts = parseArgs(["Mass's", 'Big', 'Day!', '--tags', 'news,stream'], NOW)
    const file = await createPost(opts, dir)
    assert.equal(file, join(dir, 'mass-s-big-day.md'))
    const text = await readFile(file, 'utf8')
    assert.deepEqual(parseFrontmatter(text), { title: "Mass's Big Day!", description: '', pubDate: '2026-09-25', tags: ['news', 'stream'], draft: false })
    await assert.rejects(createPost(opts, dir), /already exists/)
    await assert.rejects(createPost({ ...opts, title: '!!!' }, dir), /Cannot build a file name/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI prints the new path and fails on a duplicate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'posts-'))
  try {
    const env = { ...process.env, POSTS_DIR: dir }
    const { stdout } = await exec(process.execPath, [SCRIPT, 'Hello World', '--draft'], { env, cwd: dir })
    assert.equal(stdout.trim(), 'hello-world.md')
    assert.match(await readFile(join(dir, 'hello-world.md'), 'utf8'), /^---\ntitle: 'Hello World'\n[\s\S]*draft: true\n---\n/)
    await assert.rejects(exec(process.execPath, [SCRIPT, 'Hello World'], { env, cwd: dir }), (err) => err.code === 1 && /already exists/.test(err.stderr))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
