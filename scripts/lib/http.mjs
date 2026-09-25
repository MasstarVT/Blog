// Tiny fetch wrapper for the data scripts: timeouts, one jittered retry on network errors /
// 429 / 5xx, typed HttpError on non-2xx. URLs in errors are redacted (no tokens or keys).

export const USER_AGENT = 'masstar-blog-builder (+https://blog.masstar.org)'

const SECRET_PARAM = /^(?:key|api_?key|token|access_token|refresh_token|client_secret|secret|password|sig|signature)$/i

/** Strip credentials and secret-looking query values from a URL before it is logged. */
export function redactUrl(url) {
  try {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, 'REDACTED')
    return u.toString()
  } catch {
    return '[invalid url]'
  }
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

export class OfflineError extends Error {
  constructor(url) {
    super(`offline: ${url}`)
    this.name = 'OfflineError'
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const retryable = (status) => status === 429 || status >= 500

function backoff(attempt, base) {
  return Math.round(base * 2 ** attempt * (0.5 + Math.random()))
}

function retryAfterMs(res) {
  const v = res.headers.get('retry-after')
  if (!v) return null
  const secs = Number(v)
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(v) - Date.now()
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 5000) : null
}

function describeNetworkError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout'
  return err?.cause?.code ?? err?.code ?? err?.name ?? 'error'
}

/**
 * Fetch `url` and return the body as text (`as: 'text'`) or parsed JSON (`as: 'json'`).
 * Options: headers, method, body, timeoutMs (per attempt), retries, backoffMs, fetch (injectable).
 */
export async function request(url, {
  as = 'text', headers = {}, method = 'GET', body, timeoutMs = 10_000, retries = 1, backoffMs = 500,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const safeUrl = redactUrl(url)
  const h = new Headers({ 'User-Agent': USER_AGENT })
  for (const [k, v] of Object.entries(headers)) h.set(k, v)

  for (let attempt = 0; ; attempt++) {
    let res
    let text
    try {
      res = await fetchImpl(url, { method, headers: h, body, signal: AbortSignal.timeout(timeoutMs) })
      text = res.ok ? await res.text() : null
      if (!res.ok) await res.body?.cancel?.().catch(() => {})
    } catch (err) {
      if (attempt < retries) {
        await sleep(backoff(attempt, backoffMs))
        continue
      }
      throw new Error(`Network error (${describeNetworkError(err)}) ${method} ${safeUrl}`)
    }

    if (res.ok) {
      if (as !== 'json') return text
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`Invalid JSON from ${safeUrl}`)
      }
    }
    if (retryable(res.status) && attempt < retries) {
      await sleep(retryAfterMs(res) ?? backoff(attempt, backoffMs))
      continue
    }
    throw new HttpError(res.status, safeUrl)
  }
}

export const fetchJson = (url, opts = {}) => request(url, { ...opts, as: 'json' })
export const fetchText = (url, opts = {}) => request(url, { ...opts, as: 'text' })

/**
 * A client bound to one fetch implementation and default options. In offline mode every call
 * rejects with OfflineError without touching the network.
 */
export function createHttp({ fetch = globalThis.fetch, offline = false, ...defaults } = {}) {
  const call = (as) => (url, opts = {}) =>
    offline
      ? Promise.reject(new OfflineError(redactUrl(url)))
      : request(url, { fetch, ...defaults, ...opts, as })
  return { fetchJson: call('json'), fetchText: call('text'), offline }
}
