// Build output shows dates in UTC. In the browser, re-render every <time data-local> in the
// visitor's own time zone, and hide schedule items that have already ended (the build
// snapshot can be hours old).
import { relativeTime } from '../lib/format.mjs'

const FORMATS = {
  date: { dateStyle: 'medium' },
  datetime: { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  time: { hour: 'numeric', minute: '2-digit' },
  weekday: { weekday: 'short' },
  day: { day: 'numeric' },
  month: { month: 'short' },
  long: { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' },
}

function render() {
  const now = Date.now()
  for (const el of document.querySelectorAll('time[data-local]')) {
    const iso = el.getAttribute('datetime')
    if (!iso) continue
    const kind = el.dataset.local || 'datetime'
    el.textContent = kind === 'relative'
      ? relativeTime(iso, now)
      : new Intl.DateTimeFormat(undefined, FORMATS[kind] ?? FORMATS.datetime).format(new Date(iso))
    if (kind !== 'relative') el.title = new Intl.DateTimeFormat(undefined, FORMATS.long).format(new Date(iso))
  }
  for (const el of document.querySelectorAll('[data-ends]')) {
    if (new Date(el.dataset.ends).getTime() < now) el.hidden = true
  }
  for (const list of document.querySelectorAll('[data-schedule-list]')) {
    const empty = list.parentElement?.querySelector('[data-schedule-empty]')
    if (empty) empty.hidden = list.querySelectorAll('[data-ends]:not([hidden])').length > 0
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  document.querySelectorAll('[data-local-zone]').forEach((el) => { el.textContent = `Times shown in your time zone (${zone}).` })
}

render()
document.addEventListener('astro:page-load', render)
