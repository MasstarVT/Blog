#!/usr/bin/env node
// Deploy gate for the scheduled workflow: redeploy only when the freshly fetched data or the set
// of published posts differs from what is live, or the live build is older than 6 hours.
//
//   node scripts/data-changed.mjs --event <github event name> --force <true|false> >> "$GITHUB_OUTPUT"
//
// Prints `deploy=true|false` and `reason=...` on stdout. Never throws: when in doubt, deploy.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchJson } from './lib/http.mjs'
import { generatedDir, isEntryModule, previousDataUrl } from './lib/run-source.mjs'

export const MAX_AGE_MS = 6 * 60 * 60 * 1000

export function parseArgs(argv) {
  const opts = { event: '', force: false }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2)
    const value = inline ?? argv[i + 1]
    if (flag === '--event') {
      opts.event = String(value ?? '').trim()
      if (inline === undefined) i++
    } else if (flag === '--force') {
      opts.force = /^(?:true|1|yes)$/i.test(String(value ?? '').trim())
      if (inline === undefined) i++
    }
  }
  return opts
}

/** Pure decision table. `local` / `previous` are meta.json objects (or null). */
export function decide({ event, force, local, previous, now = Date.now(), maxAgeMs = MAX_AGE_MS }) {
  if (force) return { deploy: true, reason: 'forced' }
  if (event !== 'schedule') return { deploy: true, reason: `event:${event || 'unknown'}` }
  if (!local?.hash) return { deploy: true, reason: 'local-meta-missing' }
  if (!previous?.hash) return { deploy: true, reason: 'previous-meta-missing' }
  if (local.hash !== previous.hash) return { deploy: true, reason: 'data-changed' }
  if (local.postsHash !== previous.postsHash) return { deploy: true, reason: 'posts-changed' }
  if (local.commit && local.commit !== previous.commit) return { deploy: true, reason: 'code-changed' }
  const built = Date.parse(previous.builtAt ?? '')
  if (Number.isNaN(built) || new Date(now).getTime() - built > maxAgeMs) return { deploy: true, reason: 'max-age' }
  return { deploy: false, reason: 'unchanged' }
}

/** Resolve inputs and decide. Every failure turns into deploy=true. */
export async function run({ argv = [], env = process.env, fetch = globalThis.fetch, now = Date.now(), dir = generatedDir(env) } = {}) {
  try {
    const { event, force } = parseArgs(argv)
    if (force || event !== 'schedule') return decide({ event, force })

    let local = null
    try {
      local = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    } catch {}

    let previous = null
    try {
      previous = await fetchJson(`${previousDataUrl(env).replace(/\/+$/, '')}/meta.json`, { fetch, timeoutMs: 10_000, retries: 1 })
    } catch {}

    return decide({ event, force, local, previous, now })
  } catch (err) {
    return { deploy: true, reason: `error:${String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 80)}` }
  }
}

// import.meta.main (Node >= 24.2) also works when started through a symlink or junction.
const isMain = import.meta.main ?? isEntryModule(import.meta.url)

if (isMain) {
  run({ argv: process.argv.slice(2) })
    .catch((err) => ({ deploy: true, reason: `error:${err?.message ?? err}` }))
    .then(({ deploy, reason }) => {
      console.log(`deploy=${deploy}`)
      console.log(`reason=${reason}`)
    })
}
