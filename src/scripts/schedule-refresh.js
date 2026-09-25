// The schedule baked into the page can be up to a few hours old. Twitch's public iCalendar feed
// allows cross-origin requests, so re-read it in the browser and re-render the list when the
// upcoming streams changed (e.g. a stream was added after the last build).
import { expandTwitchICal } from '../lib/normalize/ical.mjs'
import { site, urls } from '../config/site.mjs'

const CACHE_KEY = 'masstar:ical'
const MAX_AGE_MS = 10 * 60_000

async function fetchICal() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null')
    if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.text
  } catch {}
  const res = await fetch(urls.twitchICal, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(String(res.status))
  const text = await res.text()
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), text })) } catch {}
  return text
}

const fmt = (iso, opts) => new Intl.DateTimeFormat(undefined, opts).format(new Date(iso))

function renderItem(s) {
  const li = document.createElement('li')
  li.className = `schedule-item${s.canceled ? ' is-canceled' : ''}`
  li.dataset.ends = s.end ?? new Date(new Date(s.start).getTime() + 3 * 3600_000).toISOString()

  const date = document.createElement('div')
  date.className = 'schedule-date'
  date.setAttribute('aria-hidden', 'true')
  for (const [cls, opts] of [['sd-weekday', { weekday: 'short' }], ['sd-day', { day: 'numeric' }], ['sd-month', { month: 'short' }]]) {
    const t = document.createElement('time')
    t.className = cls
    t.dateTime = s.start
    t.textContent = fmt(s.start, opts)
    date.append(t)
  }

  const info = document.createElement('div')
  info.className = 'schedule-info'
  const title = document.createElement('span')
  title.className = 'schedule-title'
  title.textContent = s.title || 'Stream'
  const meta = document.createElement('span')
  meta.className = 'schedule-meta'
  const when = document.createElement('time')
  when.dateTime = s.start
  when.textContent = fmt(s.start, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  meta.append(when)
  if (s.category) meta.append(Object.assign(document.createElement('span'), { textContent: s.category }))
  if (s.recurring) meta.append(Object.assign(document.createElement('span'), { className: 'chip', textContent: 'Weekly' }))
  if (s.canceled) meta.append(Object.assign(document.createElement('span'), { className: 'chip chip-canceled', textContent: 'Canceled' }))
  info.append(title, meta)

  li.append(date, info)
  return li
}

async function refresh() {
  const lists = document.querySelectorAll('[data-schedule-list]')
  if (!lists.length) return
  const segments = expandTwitchICal(await fetchICal(), { now: new Date(), days: 14 })
  if (!segments.length) return // keep the build data (it may come from the richer Helix API)
  for (const list of lists) {
    const limit = Number(list.dataset.limit) || 25
    const next = segments.slice(0, limit)
    const shown = [...list.querySelectorAll('[data-ends]:not([hidden]) .schedule-meta time')].map((t) => t.dateTime)
    const incoming = next.map((s) => new Date(s.start).toISOString())
    const same = shown.length === incoming.length && shown.every((iso, i) => new Date(iso).toISOString() === incoming[i])
    if (same) continue
    list.replaceChildren(...next.map(renderItem))
    const empty = list.parentElement?.querySelector('[data-schedule-empty]')
    if (empty) empty.hidden = true
  }
}

document.addEventListener('astro:page-load', () => {
  if (site.twitch.id) refresh().catch(() => {})
})
