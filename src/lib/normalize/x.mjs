// Normalizers for X (Twitter): post URLs, the official oEmbed endpoint and the optional v2 API.
// Only plain text is extracted from oEmbed HTML; the HTML itself is never stored.

const HOST = /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i
const HANDLE = /^[A-Za-z0-9_]{1,15}$/
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function decodeHtmlEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

/** HTML fragment → plain text (<br> → newline, tags stripped, entities decoded). */
export function htmlToText(html) {
  const text = String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeHtmlEntities(text).replace(/[ \t]+\n/g, '\n').trim()
}

/**
 * x.com / twitter.com post URL → { id, handle|null, url } with the query string stripped.
 * `url` is canonical: https://x.com/<handle>/status/<id>, or https://x.com/i/status/<id> when the URL
 * has no handle (/i/status/ and /i/web/status/). The /i/web/ form is avoided because oEmbed answers
 * it with 404, which would read as "deleted". Returns null for anything else.
 */
export function parseXPostUrl(input) {
  let u
  try {
    u = new URL(String(input ?? '').trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || !HOST.test(u.hostname)) return null
  const m = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})(?:\/|$)/.exec(u.pathname)
  if (m && m[1].toLowerCase() !== 'i') return { id: m[2], handle: m[1], url: `https://x.com/${m[1]}/status/${m[2]}` }
  const w = /^\/i\/(?:web\/)?status\/(\d{1,25})(?:\/|$)/.exec(u.pathname)
  if (w) return { id: w[1], handle: null, url: `https://x.com/i/status/${w[1]}` }
  return null
}

/** 'May 5, 2014' → '2014-05-05' (ISO date), else null. */
export function parseMonthDate(text) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(String(text ?? '').trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  const d = new Date(Date.UTC(+m[3], month, +m[2]))
  return d.getUTCDate() === +m[2] ? d.toISOString().slice(0, 10) : null
}

const handleFromUrl = (url) => {
  const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i.exec(String(url ?? ''))
  return m ? m[1] : null
}

/** A post we could not enrich: just the link. */
export function linkPost(ref, fallbackHandle = null) {
  const handle = ref.handle ?? fallbackHandle
  return {
    id: ref.id,
    url: handle ? `https://x.com/${handle}/status/${ref.id}` : ref.url,
    createdAt: null,
    text: null,
    authorName: null,
    authorHandle: handle,
    richness: 'link',
  }
}

/** publish.x.com/oembed JSON → XPost (richness 'oembed'). */
export function parseOEmbed(json, url) {
  const ref = parseXPostUrl(url) ?? parseXPostUrl(json?.url)
  if (!ref) throw new Error('X oEmbed: not a post URL')
  const html = String(json?.html ?? '')
  const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)
  const text = p ? htmlToText(p[1]) || null : null
  const handleInHtml = /\(@([A-Za-z0-9_]{1,15})\)/.exec(html)?.[1] ?? null
  const handle = handleFromUrl(json?.author_url) ?? handleInHtml ?? ref.handle
  let date = null
  for (const [, label] of html.matchAll(/<a\b[^>]*>([^<]+)<\/a>/gi)) date = parseMonthDate(label) ?? date
  return {
    id: ref.id,
    url: handle ? `https://x.com/${handle}/status/${ref.id}` : ref.url,
    createdAt: date,
    text,
    authorName: str(json?.author_name),
    authorHandle: handle,
    richness: 'oembed',
  }
}

/** GET /2/users/:id/tweets → XPost[] (richness 'api'). */
export function normalizeApiTweets(json, handle, { authorName = null, limit = Infinity } = {}) {
  if (!HANDLE.test(String(handle ?? ''))) throw new Error('X API: invalid handle')
  const users = Array.isArray(json?.includes?.users) ? json.includes.users : []
  return (Array.isArray(json?.data) ? json.data : [])
    .filter((t) => /^\d{1,25}$/.test(String(t?.id ?? '')))
    .slice(0, limit)
    .map((t) => {
      const created = Date.parse(t.created_at ?? '')
      return {
        id: String(t.id),
        url: `https://x.com/${handle}/status/${t.id}`,
        createdAt: Number.isNaN(created) ? null : new Date(created).toISOString(),
        text: decodeHtmlEntities(t.text ?? '').trim() || null,
        authorName: str(users.find((u) => u.id === t.author_id)?.name) ?? str(authorName),
        authorHandle: handle,
        richness: 'api',
      }
    })
}
