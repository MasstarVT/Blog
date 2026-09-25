import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseICal, expandTwitchICal, unfoldLines, cleanTzid, zonedWallToUtc, tzOffsetMs, parseDuration, parseRRule, unescapeText,
} from '../../src/lib/normalize/ical.mjs'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const NOW = '2026-10-25T12:00:00Z'
const iso = (ms) => new Date(ms).toISOString()
const wall = (s) => Date.parse(`${s}Z`)

/** Minimal calendar around VEVENT lines. */
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')

test('real masstarvt calendar (empty, LF endings) parses to no segments', () => {
  const text = fixture('twitch-ical-empty.ics')
  const parsed = parseICal(text)
  assert.equal(parsed.events.length, 0)
  assert.equal(parsed.props.NAME[0].value, 'MasstarVT')
  assert.equal(parsed.props['REFRESH-INTERVAL'][0].params.VALUE, 'DURATION')
  assert.deepEqual(expandTwitchICal(text, { now: NOW }), [])
})

test('fixture uses CRLF and folded lines', () => {
  const text = fixture('twitch-ical-dst.ics')
  assert.ok(text.includes('\r\n '), 'has a space-folded line')
  assert.ok(text.includes('\r\n\t'), 'has a tab-folded line')
  const lines = unfoldLines(text)
  assert.ok(lines.includes('RRULE:FREQ=WEEKLY;BYDAY=TU,SA'))
})

test('Twitch iCal expansion: DST change, EXDATE, override, cancelled, blanks, COUNT, floating', () => {
  const segments = expandTwitchICal(fixture('twitch-ical-dst.ics'), { now: NOW })
  const title = 'Cozy Tuesday & Saturday streams, with a title long enough that Twitch folds it onto a second line'
  assert.deepEqual(segments, [
    // 19:00 America/New_York while on EDT (UTC-4)
    { id: 'weekly-tu-sa@2026-10-27T23:00:00.000Z', title, category: 'Just Chatting', start: '2026-10-27T23:00:00.000Z', end: '2026-10-28T02:00:00.000Z', recurring: true, canceled: false },
    { id: 'cancelled-collab@2026-10-28T23:00:00.000Z', title: 'Special collab', category: 'Minecraft', start: '2026-10-28T23:00:00.000Z', end: '2026-10-29T01:00:00.000Z', recurring: false, canceled: true },
    { id: 'daily-count@2026-10-30T16:00:00.000Z', title: 'Subathon check-in', category: null, start: '2026-10-30T16:00:00.000Z', end: '2026-10-30T17:00:00.000Z', recurring: true, canceled: false },
    { id: 'daily-count@2026-10-31T16:00:00.000Z', title: 'Subathon check-in', category: null, start: '2026-10-31T16:00:00.000Z', end: '2026-10-31T17:00:00.000Z', recurring: true, canceled: false },
    // Saturday Oct 31 is EXDATE'd; COUNT=3 ends the daily series after Nov 1 (noon EST = 17:00Z)
    { id: 'daily-count@2026-11-01T17:00:00.000Z', title: 'Subathon check-in', category: null, start: '2026-11-01T17:00:00.000Z', end: '2026-11-01T18:00:00.000Z', recurring: true, canceled: false },
    // blank SUMMARY/CATEGORIES, Europe/London is on GMT again, DURATION instead of DTEND
    { id: 'london-single@2026-11-03T20:00:00.000Z', title: 'Stream', category: null, start: '2026-11-03T20:00:00.000Z', end: '2026-11-03T22:00:00.000Z', recurring: false, canceled: false },
    // RECURRENCE-ID override moves Tuesday Nov 3 from 19:00 to 21:00 EST
    { id: 'weekly-tu-sa@2026-11-04T02:00:00.000Z', title: 'Moved stream', category: 'Just Chatting', start: '2026-11-04T02:00:00.000Z', end: '2026-11-04T04:00:00.000Z', recurring: true, canceled: false },
    // floating time → UTC, INTERVAL=2 from Thu Jan 1, UNTIL keeps Nov 5
    { id: 'biweekly-floating@2026-11-05T18:00:00.000Z', title: 'Art stream', category: 'Art', start: '2026-11-05T18:00:00.000Z', end: null, recurring: true, canceled: false },
    // 19:00 America/New_York after the change to EST (UTC-5)
    { id: 'weekly-tu-sa@2026-11-08T00:00:00.000Z', title, category: 'Just Chatting', start: '2026-11-08T00:00:00.000Z', end: '2026-11-08T03:00:00.000Z', recurring: true, canceled: false },
  ])
})

test('expansion is deterministic and independent of line endings', () => {
  const crlf = fixture('twitch-ical-dst.ics')
  const lf = crlf.replace(/\r\n/g, '\n')
  assert.deepEqual(expandTwitchICal(crlf, { now: NOW }), expandTwitchICal(lf, { now: new Date(NOW) }))
  assert.deepEqual(expandTwitchICal(crlf, { now: NOW }), expandTwitchICal(crlf, { now: Date.parse(NOW) }))
})

test('an in-progress segment is kept, ended ones are dropped; limit and days apply', () => {
  const text = fixture('twitch-ical-dst.ics')
  const during = expandTwitchICal(text, { now: '2026-10-28T00:00:00Z', days: 1 })
  assert.deepEqual(during.map((s) => s.id), ['weekly-tu-sa@2026-10-27T23:00:00.000Z', 'cancelled-collab@2026-10-28T23:00:00.000Z'])
  assert.equal(expandTwitchICal(text, { now: NOW, limit: 2 }).length, 2)
})

test('time zones: TZID slash bug, invalid ids, DST gap and overlap', () => {
  assert.equal(cleanTzid('/America/New_York'), 'America/New_York')
  assert.equal(cleanTzid('"/Europe/Berlin"'), 'Europe/Berlin')
  assert.equal(cleanTzid('Not/A_Zone'), 'UTC')
  assert.equal(cleanTzid('UTC'), 'UTC')
  assert.equal(tzOffsetMs(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York'), -4 * 3600_000)
  assert.equal(tzOffsetMs(Date.parse('2026-12-01T12:00:00Z'), 'America/New_York'), -5 * 3600_000)
  // 02:30 does not exist on 2026-03-08 in New York → offset before the gap (EST) → 07:30Z (= 03:30 EDT)
  assert.equal(iso(zonedWallToUtc(wall('2026-03-08T02:30:00'), 'America/New_York')), '2026-03-08T07:30:00.000Z')
  // 01:30 happens twice on 2026-11-01 → first occurrence (EDT) → 05:30Z
  assert.equal(iso(zonedWallToUtc(wall('2026-11-01T01:30:00'), 'America/New_York')), '2026-11-01T05:30:00.000Z')
  assert.equal(iso(zonedWallToUtc(wall('2026-07-01T20:00:00'), 'Europe/London')), '2026-07-01T19:00:00.000Z')
  assert.equal(iso(zonedWallToUtc(wall('2026-07-01T20:00:00'), 'Asia/Kolkata')), '2026-07-01T14:30:00.000Z')
  assert.equal(iso(zonedWallToUtc(wall('2026-07-01T20:00:00'), 'UTC')), '2026-07-01T20:00:00.000Z')
})

test('RRULE: UNTIL cut-off, COUNT, INTERVAL, DATE-only EXDATE, all-day events', () => {
  const text = cal(
    ['UID:until', 'DTSTART:20261026T180000Z', 'DTEND:20261026T190000Z', 'RRULE:FREQ=DAILY;UNTIL=20261028T180000Z'],
    ['UID:count', 'DTSTART;TZID=America/Chicago:20261001T200000', 'RRULE:FREQ=WEEKLY;COUNT=5', 'DURATION:PT1H30M'],
    ['UID:interval', 'DTSTART:20261026T100000Z', 'RRULE:FREQ=DAILY;INTERVAL=3;COUNT=10', 'EXDATE;VALUE=DATE:20261101', 'DURATION:PT1H'],
    ['UID:allday', 'DTSTART;VALUE=DATE:20261030', 'SUMMARY:Day off\\nno stream'],
  )
  const segs = expandTwitchICal(text, { now: NOW, limit: 100 })
  const ids = (prefix) => segs.filter((s) => s.id.startsWith(`${prefix}@`)).map((s) => s.start)
  assert.deepEqual(ids('until'), ['2026-10-26T18:00:00.000Z', '2026-10-27T18:00:00.000Z', '2026-10-28T18:00:00.000Z'])
  // Oct 1, 8, 15, 22, 29 → only the 29th (20:00 CDT) is upcoming; COUNT=5 ends the series
  assert.deepEqual(ids('count'), ['2026-10-30T01:00:00.000Z'])
  assert.equal(segs.find((s) => s.id.startsWith('count@')).end, '2026-10-30T02:30:00.000Z')
  // Oct 26, 29, Nov 1 (EXDATE by date), Nov 4, Nov 7
  assert.deepEqual(ids('interval'), ['2026-10-26T10:00:00.000Z', '2026-10-29T10:00:00.000Z', '2026-11-04T10:00:00.000Z', '2026-11-07T10:00:00.000Z'])
  const allDay = segs.find((s) => s.id.startsWith('allday@'))
  assert.deepEqual([allDay.start, allDay.end, allDay.title], ['2026-10-30T00:00:00.000Z', '2026-10-31T00:00:00.000Z', 'Day off\nno stream'])
})

test('RRULE: WKST and BYDAY ordering, unsupported FREQ falls back to the single DTSTART', () => {
  const text = cal(
    ['UID:wk', 'DTSTART:20261025T150000Z', 'RRULE:FREQ=WEEKLY;BYDAY=SU,MO;WKST=SU;COUNT=3'],
    ['UID:monthly', 'DTSTART:20261026T150000Z', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=26'],
  )
  const segs = expandTwitchICal(text, { now: NOW, days: 40, limit: 100 })
  assert.deepEqual(segs.filter((s) => s.id.startsWith('wk@')).map((s) => s.start), ['2026-10-25T15:00:00.000Z', '2026-10-26T15:00:00.000Z', '2026-11-01T15:00:00.000Z'])
  assert.deepEqual(segs.filter((s) => s.id.startsWith('monthly@')).map((s) => s.start), ['2026-10-26T15:00:00.000Z'])
})

test('events without DTSTART or UID are handled', () => {
  const segs = expandTwitchICal(cal(['SUMMARY:no start'], ['DTSTART:20261026T150000Z', 'SUMMARY:no uid']), { now: NOW })
  assert.deepEqual(segs.map((s) => s.id), ['event-1@2026-10-26T15:00:00.000Z'])
  assert.equal(segs[0].end, null)
})

test('value helpers', () => {
  assert.equal(parseDuration('PT3H'), 3 * 3600_000)
  assert.equal(parseDuration('P1DT2H30M'), (24 + 2.5) * 3600_000)
  assert.equal(parseDuration('P1W'), 7 * 86_400_000)
  assert.equal(parseDuration('-PT15M'), -15 * 60_000)
  assert.equal(parseDuration('P'), null)
  assert.equal(parseDuration('nonsense'), null)
  assert.deepEqual(parseRRule('FREQ=WEEKLY;BYDAY=1MO,TU,XX,TU;INTERVAL=0'), { freq: 'WEEKLY', interval: 1, count: null, until: null, byday: ['MO', 'TU'], wkst: 'MO' })
  assert.equal(parseRRule(''), null)
  assert.equal(parseRRule('BYDAY=MO'), null)
  assert.equal(unescapeText('a\\, b\\; c\\\\d\\Ne'), 'a, b; c\\d\ne')
})
