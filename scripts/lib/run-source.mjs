// Per-part fallback for the data sources: fresh data when a fetch works, the previously
// deployed data (marked stale) when it fails, the empty default shape as a last resort.
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchJson } from './http.mjs'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const DEFAULT_PREVIOUS_DATA_URL = 'https://blog.masstar.org/data'

/**
 * Is the module at `moduleUrl` the script node was started with? Fallback for runtimes without
 * import.meta.main. Both sides go through realpath: import.meta.url has symlinks and junctions
 * resolved, process.argv[1] does not.
 */
export function isEntryModule(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false
  try {
    const a = realpathSync(fileURLToPath(moduleUrl))
    const b = realpathSync(resolve(entry))
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  } catch {
    return false
  }
}

/** Output directory for generated JSON; GENERATED_DIR overrides it (tests, CI experiments). */
export function generatedDir(env = process.env) {
  return env.GENERATED_DIR ? resolve(env.GENERATED_DIR) : join(ROOT, 'src', 'data', 'generated')
}

export const previousDataUrl = (env = process.env) => env.PREVIOUS_DATA_URL || DEFAULT_PREVIOUS_DATA_URL

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Thrown (via skip()) when a part cannot run by design, e.g. no credentials configured. */
export class SkipError extends Error {
  constructor(reason, { keepPrevious = false } = {}) {
    super(`skipped:${reason}`)
    this.name = 'SkipError'
    this.reason = reason
    this.keepPrevious = keepPrevious
  }
}

export function skip(reason, options) {
  throw new SkipError(reason, options)
}

/**
 * Previous data for `name`: the local generated file, else the deployed copy at
 * `${PREVIOUS_DATA_URL}/<name>.json` (5s timeout), else null. Never throws.
 */
export async function loadPrevious(name, {
  dir = generatedDir(), baseUrl = previousDataUrl(), fetch = globalThis.fetch, offline = false, timeoutMs = 5000,
} = {}) {
  try {
    const json = JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'))
    if (isObject(json)) return json
  } catch {}
  if (offline || !baseUrl) return null
  try {
    const json = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/${name}.json`, { fetch, timeoutMs, retries: 0 })
    if (isObject(json)) return json
  } catch {}
  return null
}

/** Previous data counts only if it was fetched successfully at some point. */
export const hasData = (prev) => isObject(prev) && prev.fetchedAt != null && prev.status !== 'empty'

export function errorMessage(err) {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/\s+/g, ' ').slice(0, 300)
}

/**
 * Run one part. Always resolves:
 *   ok      → { ...def, ...data, fetchedAt: now, status: 'ok' }  (an empty list is still ok)
 *   skip()  → { ...def (or prev when keepPrevious), status: 'skipped:<reason>' }
 *   throws  → prev with data ? { ...prev, status: 'stale', staleSince } : { ...def, status: 'empty' }
 * `report({ name, status, error?, ms })` is called once with the outcome.
 */
export async function runPart(name, fn, prev, def, { now = new Date(), report } = {}) {
  const started = Date.now()
  const done = (out, error) => {
    report?.({ name, status: out.status, ...(error ? { error } : {}), ms: Date.now() - started })
    return out
  }
  try {
    const data = await fn()
    return done({ ...def, ...data, fetchedAt: new Date(now).toISOString(), status: 'ok' })
  } catch (err) {
    if (err instanceof SkipError) {
      const base = err.keepPrevious && hasData(prev) ? { ...def, ...prev } : { ...def }
      delete base.staleSince
      return done({ ...base, status: `skipped:${err.reason}` })
    }
    const error = errorMessage(err)
    if (hasData(prev)) {
      return done({ ...def, ...prev, status: 'stale', staleSince: prev.staleSince ?? prev.fetchedAt }, error)
    }
    return done({ ...def, status: 'empty' }, error)
  }
}
