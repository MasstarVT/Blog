// iCalendar (RFC 5545) parsing and expansion for Twitch's schedule feed
// (https://api.twitch.tv/helix/schedule/icalendar). Browser-safe: Intl only, no Node imports.
//
// Twitch quirks handled: no VTIMEZONE blocks (TZIDs are IANA names resolved through Intl),
// a leading slash in TZID (`TZID=/America/New_York`), blank SUMMARY/CATEGORIES, recurring
// segments whose DTSTART lies in the past (RRULE is expanded), folded lines.

const DAY_MS = 86_400_000
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const FALLBACK_TITLE = 'Stream'
const MAX_ITERATIONS = 20_000

// ---------------------------------------------------------------------------------------------
// Lexing

/** Split into logical lines: CRLF/CR/LF, then unfold continuation lines (leading space/tab). */
export function unfoldLines(text) {
  return String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
}

function splitOutsideQuotes(s, sep) {
  const out = []
  let cur = ''
  let quoted = false
  for (const c of s) {
    if (c === '"') quoted = !quoted
    if (c === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

/** `NAME;P1=a;P2="b:c":value` → { name, params, value } */
function parseContentLine(line) {
  let quoted = false
  let i = 0
  for (; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === ':' && !quoted) break
  }
  if (i >= line.length) return null
  const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, i), ';')
  const params = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
  }
  return { name: name.trim().toUpperCase(), params, value: line.slice(i + 1) }
}

/** TEXT value unescaping (\n \, \; \\). */
export function unescapeText(v) {
  return String(v ?? '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Split a multi-value TEXT on commas that are not escaped (no regex lookbehind: older Safari). */
function splitTextList(v) {
  const out = []
  let cur = ''
  for (let i = 0; i < v.length; i++) {
    const c = v[i]
    if (c === '\\' && i + 1 < v.length) {
      cur += c + v[i + 1]
      i++
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((s) => unescapeText(s).trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------------------------
// Time zones

const formatters = new Map()

function formatter(tz) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    formatters.set(tz, f)
  }
  return f
}

/** Clean a TZID (Twitch's leading-slash bug, quotes) and verify Intl knows it; else 'UTC'. */
export function cleanTzid(tzid) {
  const tz = String(tzid ?? '').trim().replace(/^"|"$/g, '').replace(/^\/+/, '')
  if (!tz || /^(?:z|utc|gmt|etc\/utc|etc\/gmt)$/i.test(tz)) return 'UTC'
  try {
    formatter(tz)
    return tz
  } catch {
    return 'UTC'
  }
}

/** UTC offset (ms) of `tz` at the instant `utcMs`. */
export function tzOffsetMs(utcMs, tz) {
  const p = {}
  for (const part of formatter(tz).formatToParts(new Date(utcMs))) p[part.type] = part.value
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/**
 * Wall-clock time in `tz` (given as a naive UTC epoch) → real UTC epoch. Ambiguous times
 * (DST fall-back) resolve to the first occurrence; non-existent times (spring-forward gap)
 * use the offset before the gap, as RFC 5545 §3.3.5 prescribes.
 */
export function zonedWallToUtc(wallMs, tz) {
  if (!tz || tz === 'UTC') return wallMs
  const before = tzOffsetMs(wallMs - DAY_MS, tz)
  const after = tzOffsetMs(wallMs + DAY_MS, tz)
  const valid = [wallMs - before, wallMs - after].filter((t) => t + tzOffsetMs(t, tz) === wallMs)
  return valid.length ? Math.min(...valid) : wallMs - before
}

// ---------------------------------------------------------------------------------------------
// Values

/**
 * DATE / DATE-TIME value → { wall (naive epoch ms), tz: 'UTC' | IANA name | null (floating),
 * dateOnly }. Returns null when unparseable.
 */
export function parseDateValue(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(String(value ?? '').trim())
  if (!m) return null
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  if (Number.isNaN(wall)) return null
  const tz = m[7] ? 'UTC' : params.TZID ? cleanTzid(params.TZID) : null
  return { wall, tz, dateOnly: !m[4] || String(params.VALUE ?? '').toUpperCase() === 'DATE' }
}

/** Floating times (no TZID, no Z) are treated as UTC. */
const toUtc = (dv) => zonedWallToUtc(dv.wall, dv.tz ?? 'UTC')

/** `PT3H`, `P1DT2H30M`, `-PT15M`, `P1W` → ms (days are taken as 24h). */
export function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(value ?? '').trim())
  if (!m || !(m[2] || m[3] || m[4] || m[5] || m[6])) return null
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000
  return m[1] === '-' ? -ms : ms
}

export function parseRRule(value) {
  if (!value) return null
  const r = {}
  for (const part of String(value).split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) r[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim()
  }
  if (!r.FREQ) return null
  const count = Number.parseInt(r.COUNT, 10)
  const byday = r.BYDAY
    ? [...new Set(r.BYDAY.split(',').map((d) => d.trim().toUpperCase().slice(-2)).filter((d) => WEEKDAYS.includes(d)))]
    : []
  const wkst = String(r.WKST ?? '').toUpperCase()
  return {
    freq: r.FREQ.toUpperCase(),
    interval: Math.max(1, Number.parseInt(r.INTERVAL, 10) || 1),
    count: Number.isFinite(count) && count > 0 ? count : null,
    until: r.UNTIL ? parseDateValue(r.UNTIL) : null,
    byday,
    wkst: WEEKDAYS.includes(wkst) ? wkst : 'MO',
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing

function toEvent(props, index) {
  const first = (n) => props[n]?.[0]
  const text = (n) => unescapeText(first(n)?.value ?? '').trim()
  const dateProp = (n) => (first(n) ? parseDateValue(first(n).value, first(n).params) : null)
  return {
    uid: text('UID') || `event-${index}`,
    summary: text('SUMMARY'),
    description: text('DESCRIPTION'),
    categories: (props.CATEGORIES ?? []).flatMap((p) => splitTextList(p.value)),
    status: text('STATUS').toUpperCase() || null,
    start: dateProp('DTSTART'),
    end: dateProp('DTEND'),
    duration: first('DURATION') ? parseDuration(first('DURATION').value) : null,
    rrule: parseRRule(first('RRULE')?.value),
    exdates: (props.EXDATE ?? []).flatMap((p) => p.value.split(',').map((v) => parseDateValue(v, p.params))).filter(Boolean),
    recurrenceId: dateProp('RECURRENCE-ID'),
  }
}

/**
 * Parse iCalendar text → { props, events }. `props` holds the VCALENDAR-level properties
 * ({ NAME: [{ params, value }] }); each event is a small normalized object (dates unresolved).
 * Components other than VEVENT (VTIMEZONE, VALARM, ...) are ignored.
 */
export function parseICal(text) {
  const calendar = { props: {}, events: [] }
  const stack = []
  let current = null
  for (const raw of unfoldLines(text)) {
    if (!raw.trim()) continue
    const line = parseContentLine(raw)
    if (!line) continue
    if (line.name === 'BEGIN') {
      const comp = line.value.trim().toUpperCase()
      stack.push(comp)
      if (comp === 'VEVENT') current = {}
      continue
    }
    if (line.name === 'END') {
      const comp = stack.pop()
      if (comp === 'VEVENT' && current) {
        calendar.events.push(toEvent(current, calendar.events.length))
        current = null
      }
      continue
    }
    const top = stack[stack.length - 1]
    const target = top === 'VEVENT' && current ? current : top === 'VCALENDAR' && stack.length === 1 ? calendar.props : null
    if (target) (target[line.name] ??= []).push({ params: line.params, value: line.value })
  }
  return calendar
}

// ---------------------------------------------------------------------------------------------
// Expansion

const dayKey = (wall) => new Date(wall).toISOString().slice(0, 10)

/**
 * Occurrence starts of one event as [{ wall, utc }], generated in the event's own wall-clock
 * time so a weekly 19:00 stays at 19:00 local across DST changes. Stops at `endUtc`.
 */
function occurrences(ev, endUtc) {
  const tz = ev.start.tz ?? 'UTC'
  const startWall = ev.start.wall
  const rule = ev.rrule
  const one = { wall: startWall, utc: zonedWallToUtc(startWall, tz) }
  if (!rule || (rule.freq !== 'WEEKLY' && rule.freq !== 'DAILY')) return [one]

  let untilCheck = () => true
  if (rule.until) {
    if (rule.until.tz === 'UTC') {
      const u = rule.until.wall
      untilCheck = (wall, utc) => utc <= u
    } else {
      const w = rule.until.dateOnly ? rule.until.wall + DAY_MS - 1 : rule.until.wall
      untilCheck = (wall) => wall <= w
    }
  }

  const out = []
  let count = 0
  // Returns false once generation should stop (UNTIL, COUNT or past the window).
  const emit = (wall) => {
    if (wall < startWall) return true
    const utc = zonedWallToUtc(wall, tz)
    if (!untilCheck(wall, utc)) return false
    if (rule.count != null && count >= rule.count) return false
    count++
    if (utc >= endUtc) return false
    out.push({ wall, utc })
    return true
  }

  const time = ((startWall % DAY_MS) + DAY_MS) % DAY_MS
  const startDay = startWall - time
  const startDow = new Date(startDay).getUTCDay()

  if (rule.freq === 'DAILY') {
    const days = rule.byday.length ? new Set(rule.byday.map((d) => WEEKDAYS.indexOf(d))) : null
    for (let k = 0; k < MAX_ITERATIONS; k++) {
      const wall = startWall + k * rule.interval * DAY_MS
      if (days && !days.has(new Date(wall).getUTCDay())) continue
      if (!emit(wall)) break
    }
    return out
  }

  const wkst = WEEKDAYS.indexOf(rule.wkst)
  const weekStart = startDay - ((startDow - wkst + 7) % 7) * DAY_MS
  const offsets = (rule.byday.length ? rule.byday : [WEEKDAYS[startDow]])
    .map((d) => (WEEKDAYS.indexOf(d) - wkst + 7) % 7)
    .sort((a, b) => a - b)
  outer: for (let k = 0; k < MAX_ITERATIONS; k++) {
    const base = weekStart + k * rule.interval * 7 * DAY_MS
    for (const off of offsets) if (!emit(base + off * DAY_MS + time)) break outer
  }
  return out
}

function durationOf(ev) {
  if (ev.end) return Math.max(0, toUtc(ev.end) - toUtc(ev.start))
  if (ev.duration != null) return Math.max(0, ev.duration)
  return ev.start.dateOnly ? DAY_MS : null
}

function segment(ev, startUtc, recurring) {
  const dur = durationOf(ev)
  const start = new Date(startUtc).toISOString()
  return {
    id: `${ev.uid}@${start}`,
    title: ev.summary || FALLBACK_TITLE,
    category: ev.categories[0] ?? null,
    start,
    end: dur != null ? new Date(startUtc + dur).toISOString() : null,
    recurring,
    canceled: ev.status === 'CANCELLED',
  }
}

/**
 * Twitch iCal text → ScheduleSegment[] (see src/data/defaults.mjs) for the next `days`,
 * sorted by start. Segments that already ended are dropped. Deterministic given `now`.
 */
export function expandTwitchICal(text, { now = new Date(), days = 14, limit = 25 } = {}) {
  const nowMs = new Date(now).getTime()
  const endUtc = nowMs + days * DAY_MS
  const { events } = parseICal(text)
  const valid = events.filter((ev) => ev.start)

  // RECURRENCE-ID overrides replace one generated instance of their series.
  const overridden = new Set()
  for (const ev of valid) if (ev.recurrenceId) overridden.add(`${ev.uid}|${toUtc(ev.recurrenceId)}`)
  const seriesUids = new Set(valid.filter((ev) => ev.rrule && !ev.recurrenceId).map((ev) => ev.uid))

  const segments = []
  for (const ev of valid) {
    if (ev.recurrenceId) {
      segments.push(segment(ev, toUtc(ev.start), seriesUids.has(ev.uid)))
      continue
    }
    const exUtc = new Set(ev.exdates.filter((x) => !x.dateOnly).map(toUtc))
    const exDays = new Set(ev.exdates.filter((x) => x.dateOnly).map((x) => dayKey(x.wall)))
    for (const { wall, utc } of occurrences(ev, endUtc)) {
      if (exUtc.has(utc) || exDays.has(dayKey(wall)) || overridden.has(`${ev.uid}|${utc}`)) continue
      segments.push(segment(ev, utc, Boolean(ev.rrule)))
    }
  }

  return segments
    .filter((s) => Date.parse(s.end ?? s.start) > nowMs && Date.parse(s.start) < endUtc)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .slice(0, limit)
}
