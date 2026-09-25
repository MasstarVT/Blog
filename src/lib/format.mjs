// Small formatting helpers shared by .astro components (build time) and islands (browser).

export function formatCount(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "4 months ago" / "in 3 days" */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return ''
  const diff = (new Date(iso).getTime() - now) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit)
  }
  return 'just now'
}

/** 3725 → "1:02:05", 725 → "12:05" */
export function formatDuration(sec) {
  if (!sec && sec !== 0) return ''
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`
}

/** Time since `startIso`: "1h 23m" */
export function uptime(startIso, now = Date.now()) {
  if (!startIso) return ''
  const mins = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 60_000))
  const h = Math.floor(mins / 60)
  return h ? `${h}h ${mins % 60}m` : `${mins}m`
}

/**
 * Build-time date label (UTC, so the output is deterministic); local-time.js re-renders it in the visitor's zone.
 * @param {string | null | undefined} iso
 * @param {Intl.DateTimeFormatOptions} [options]
 */
export function formatDate(iso, options = { dateStyle: 'medium' }) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(iso))
}

export function readingTime(text = '') {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
