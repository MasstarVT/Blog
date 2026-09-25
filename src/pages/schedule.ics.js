// A clean iCalendar feed of upcoming streams (UTC times), for the "Add to calendar" button.
// Twitch's own feed has no VTIMEZONE and a malformed TZID, which shifts times in some apps.
import { getData, getUpcomingSegments } from '../lib/data.js'
import { site, urls } from '../config/site.mjs'

const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space
function fold(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  out.push(current)
  return out.join('\r\n ')
}

export function GET() {
  const twitch = getData('twitch')
  const dtstamp = stamp(twitch.fetchedAt ?? new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MasstarVT//blog.masstar.org//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${site.name} streams`)}`,
    `X-WR-CALDESC:${escapeText(`Upcoming ${site.name} streams on Twitch`)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ]
  for (const s of getUpcomingSegments(50)) {
    const end = s.end ?? new Date(new Date(s.start).getTime() + 3 * 3600_000).toISOString()
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(s.id)}@blog.masstar.org`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(s.start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escapeText(`${site.name}: ${s.title || 'Stream'}`)}`,
      `DESCRIPTION:${escapeText([s.category, `Watch live: ${urls.twitch}`].filter(Boolean).join('\n'))}`,
      `URL:${urls.twitch}`,
      `LOCATION:${urls.twitch}`,
      ...(s.canceled ? ['STATUS:CANCELLED'] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  })
}
