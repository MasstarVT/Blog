// Twitch: IVR (no credentials) for the profile and live snapshot; schedule from Helix when
// app credentials exist, else the public iCal feed; VODs and clips from Helix only.
// Each part falls back independently (see runPart).
import { normalizeIvrUser, normalizeShieldsStatus, liveThumbnailUrl } from '../../../src/lib/normalize/ivr.mjs'
import { normalizeSchedule, normalizeVideos, normalizeClips, mergeClips, emptyHelixSchedule } from '../../../src/lib/normalize/helix.mjs'
import { expandTwitchICal } from '../../../src/lib/normalize/ical.mjs'
import { HttpError } from '../http.mjs'
import { runPart, skip } from '../run-source.mjs'

const DAY_MS = 86_400_000
const HELIX = 'https://api.twitch.tv/helix'
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' }

export const PARTS = ['user', 'live', 'schedule', 'videos', 'clips']
// Top-level keys of twitch.json owned by each part.
const KEYS = { user: ['user'], live: ['live', 'lastBroadcast'], schedule: ['schedule'], videos: ['videos'], clips: ['clips'] }

export function twitchCredentials(env = {}) {
  const clientId = env.TWITCH_CLIENT_ID?.trim()
  const clientSecret = env.TWITCH_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/**
 * Client-credentials app token. The secret travels in the form body, never the URL.
 * Not retried: a retry after a lost response would mint a second token that is never revoked.
 */
export async function getAppToken(http, { clientId, clientSecret }) {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
  const json = await http.fetchJson('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: FORM, body: body.toString(), retries: 0 })
  if (typeof json?.access_token !== 'string') throw new Error('Twitch: token response had no access_token')
  return json.access_token
}

export async function revokeToken(http, clientId, token) {
  const body = new URLSearchParams({ client_id: clientId, token })
  await http.fetchText('https://id.twitch.tv/oauth2/revoke', { method: 'POST', headers: FORM, body: body.toString(), retries: 0 })
}

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]))
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * When `part` last really fetched data according to the previous twitch.json, else null.
 * Files written before partFetchedAt existed only count ok/stale parts (a skipped part never fetched).
 */
function previousPartFetchedAt(prev, part) {
  const status = isObject(prev?.status) ? prev.status[part] : undefined
  if (!isObject(prev) || !status || status === 'empty') return null
  if (isObject(prev.partFetchedAt)) return prev.partFetchedAt[part] ?? null
  return status === 'ok' || status === 'stale' ? prev.staleSince?.[part] ?? prev.fetchedAt ?? null : null
}

/** The slice of the previous twitch.json that belongs to `part`, shaped for runPart. */
function previousPart(prev, part, def) {
  const fetchedAt = previousPartFetchedAt(prev, part)
  if (!fetchedAt || !KEYS[part].every((k) => prev[k] !== undefined)) return null
  const data = pick(prev, KEYS[part])
  // Never carry a stale "live" flag forward: an old LIVE badge is worse than none.
  if (part === 'live') data.live = { ...def.live }
  return { ...data, fetchedAt, staleSince: prev.staleSince?.[part] }
}

const hasUpcoming = (schedule, now) => (Array.isArray(schedule?.segments) ? schedule.segments : [])
  .some((s) => Date.parse(s?.end ?? s?.start ?? '') > now.getTime())

const isCalendar = (text) => /^\uFEFF?BEGIN:VCALENDAR\b/im.test(String(text ?? ''))

/**
 * Build twitch.json. ctx: { http, env, site, now, prev, def, raw(label, body), report(result) }.
 * Always resolves; per-part status lands in `status`, stale parts in `staleSince`, and the time each
 * part's data was really fetched in `partFetchedAt` (null for parts that never fetched).
 */
export async function buildTwitch({ http, env = {}, site, now = new Date(), prev = null, def, raw = () => {}, report }) {
  const { login, id } = site.twitch
  const creds = twitchCredentials(env)
  const nowDate = new Date(now)
  const prevParts = Object.fromEntries(PARTS.map((part) => [part, previousPart(prev, part, def)]))

  let tokenPromise = null
  const token = () => (tokenPromise ??= getAppToken(http, creds))
  const helix = async (path, params, label) => {
    const json = await http.fetchJson(`${HELIX}/${path}?${new URLSearchParams(params)}`, {
      headers: { 'Client-Id': creds.clientId, Authorization: `Bearer ${await token()}` },
    })
    raw(label, json)
    return json
  }

  let ivrPromise = null
  const ivr = () => (ivrPromise ??= http.fetchJson(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`)
    .then((json) => {
      raw('twitch-ivr-user', json)
      return normalizeIvrUser(json)
    }))

  async function live() {
    try {
      const { live: snapshot, lastBroadcast } = await ivr()
      return { live: snapshot, lastBroadcast: lastBroadcast ?? prev?.lastBroadcast ?? def.lastBroadcast }
    } catch (ivrError) {
      // Same fallback chain as the browser poller: shields.io, with DecAPI for details.
      let isLive
      try {
        const json = await http.fetchJson(`https://img.shields.io/twitch/status/${encodeURIComponent(login)}.json`)
        raw('twitch-shields', json)
        isLive = normalizeShieldsStatus(json).isLive
      } catch {
        throw ivrError
      }
      const details = isLive ? await decapiDetails() : {}
      return {
        live: { ...def.live, ...details, isLive, thumbnail: isLive ? liveThumbnailUrl(login) : null },
        lastBroadcast: prev?.lastBroadcast ?? def.lastBroadcast,
      }
    }
  }

  async function decapiDetails() {
    const get = (p) => http.fetchText(`https://decapi.me/twitch/${p}/${encodeURIComponent(login)}`, { retries: 0 }).then((t) => t.trim() || null, () => null)
    const [title, game, viewers] = await Promise.all([get('title'), get('game'), get('viewercount')])
    const v = Number.parseInt(viewers ?? '', 10)
    return { title, game, viewers: Number.isFinite(v) ? v : null }
  }

  async function schedule() {
    let helixError = null
    if (creds) {
      try {
        return normalizeSchedule(await helix('schedule', { broadcaster_id: id, first: '25' }, 'twitch-helix-schedule'), { now: nowDate })
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return emptyHelixSchedule()
        helixError = err
      }
    }
    try {
      const text = await http.fetchText(`https://api.twitch.tv/helix/schedule/icalendar?broadcaster_id=${encodeURIComponent(id)}`)
      raw('twitch-ical', text)
      // An HTML/JSON error page with status 200 must not replace good data with "no streams".
      if (!isCalendar(text)) throw new Error('Twitch iCal: response is not a calendar')
      return { source: 'ical', vacation: null, segments: expandTwitchICal(text, { now: nowDate }) }
    } catch (err) {
      if (helixError) throw helixError
      // The iCal endpoint can answer 5xx for a channel whose calendar is empty. That reads as an
      // empty schedule unless the previous data still had upcoming streams (then: outage → stale).
      if (err instanceof HttpError && err.status >= 500 && !hasUpcoming(prevParts.schedule?.schedule, nowDate)) {
        return { source: 'ical', vacation: null, segments: [] }
      }
      throw err
    }
  }

  async function clips() {
    const recentJson = await helix('clips', {
      broadcaster_id: id,
      started_at: new Date(nowDate.getTime() - 90 * DAY_MS).toISOString(),
      ended_at: nowDate.toISOString(),
      first: '20',
    }, 'twitch-helix-clips-recent')
    const recent = normalizeClips(recentJson)
    if (recent.length >= 4) return mergeClips(recent)
    const allTime = normalizeClips(await helix('clips', { broadcaster_id: id, first: '20' }, 'twitch-helix-clips-all'))
    return mergeClips(recent, allTime, 4)
  }

  const tasks = {
    user: async () => ({ user: { ...def.user, ...(await ivr()).user } }),
    live,
    schedule: async () => ({ schedule: await schedule() }),
    videos: async () => {
      if (!creds) skip('no-credentials', { keepPrevious: true })
      const json = await helix('videos', { user_id: id, type: 'all', sort: 'time', first: '12' }, 'twitch-helix-videos')
      return { videos: normalizeVideos(json) }
    },
    clips: async () => {
      if (!creds) skip('no-credentials', { keepPrevious: true })
      return { clips: await clips() }
    },
  }

  try {
    const results = await Promise.all(PARTS.map((part) => runPart(
      `twitch.${part}`, tasks[part], prevParts[part], pick(def, KEYS[part]), { now: nowDate, report },
    )))

    const out = { ...def, fetchedAt: null, status: {}, staleSince: {}, partFetchedAt: {} }
    PARTS.forEach((part, i) => {
      const r = results[i]
      out.status[part] = r.status
      if (r.status === 'stale' && r.staleSince) out.staleSince[part] = r.staleSince
      // When this part's data was really fetched (kept across stale runs and skipped:* with kept data).
      out.partFetchedAt[part] = r.fetchedAt ?? null
      for (const k of KEYS[part]) out[k] = r[k] ?? def[k]
    })
    // Top-level fetchedAt: the OLDEST real fetch among parts that hold data (ok/stale), so a stale
    // part is never presented as just checked; null when no part has data.
    out.fetchedAt = PARTS
      .filter((part) => out.status[part] === 'ok' || out.status[part] === 'stale')
      .map((part) => out.partFetchedAt[part])
      .filter(Boolean)
      .sort()[0] ?? null
    return out
  } finally {
    if (tokenPromise) {
      const t = await tokenPromise.catch(() => null)
      if (t) await revokeToken(http, creds.clientId, t).catch(() => {})
    }
  }
}
