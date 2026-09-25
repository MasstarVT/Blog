#!/usr/bin/env node
// Scaffold a blog post:  npm run new -- "Title words" [--tags a,b] [--draft] [--date YYYY-MM-DD]
// Writes src/content/posts/<slug>.md and refuses to overwrite an existing file.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { slugify } from '../src/lib/format.mjs'
import { ROOT, isEntryModule } from './lib/run-source.mjs'

const USAGE = 'usage: npm run new -- "Post title" [--tags a,b] [--draft] [--date YYYY-MM-DD]'

export function postsDir(env = process.env) {
  return env.POSTS_DIR ? resolve(env.POSTS_DIR) : join(ROOT, 'src', 'content', 'posts')
}

/** Local calendar date as YYYY-MM-DD. */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function parseArgs(argv, now = new Date()) {
  const opts = { title: '', tags: [], draft: false, date: today(now) }
  const words = []
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2)
    const next = () => (inline !== undefined ? inline : argv[++i])
    if (flag === '--draft') opts.draft = true
    else if (flag === '--tags') opts.tags = String(next() ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    else if (flag === '--date') opts.date = String(next() ?? '').trim()
    else if (argv[i].startsWith('--')) throw new Error(`Unknown option ${argv[i]}\n${USAGE}`)
    else words.push(argv[i])
  }
  opts.title = words.join(' ').trim()
  if (!opts.title) throw new Error(USAGE)
  if (!validDate(opts.date)) throw new Error(`--date must be a real date in YYYY-MM-DD form, got "${opts.date}"`)
  opts.tags = [...new Set(opts.tags)]
  return opts
}

const yamlString = (s) => `'${String(s).replace(/'/g, "''")}'`

export function renderPost({ title, tags = [], draft = false, date }) {
  return [
    '---',
    `title: ${yamlString(title)}`,
    "description: ''",
    `pubDate: ${date}`,
    `tags: [${tags.map(yamlString).join(', ')}]`,
    `draft: ${draft ? 'true' : 'false'}`,
    '---',
    '',
    '',
  ].join('\n')
}

/** Write the post file; throws if the slug is empty or the file already exists. */
export async function createPost(opts, dir = postsDir()) {
  const slug = slugify(opts.title)
  if (!slug) throw new Error(`Cannot build a file name from "${opts.title}"`)
  const file = join(dir, `${slug}.md`)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(file, renderPost(opts), { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if (err?.code === 'EEXIST') throw new Error(`${file} already exists; not overwriting`)
    throw err
  }
  return file
}

// import.meta.main (Node >= 24.2) also works when started through a symlink or junction.
const isMain = import.meta.main ?? isEntryModule(import.meta.url)

if (isMain) {
  try {
    const file = await createPost(parseArgs(process.argv.slice(2)))
    console.log(relative(process.cwd(), file) || file)
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  }
}
