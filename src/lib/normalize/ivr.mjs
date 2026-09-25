// Normalizers for the credential-free Twitch sources: IVR, shields.io and DecAPI.
// Browser-safe (no Node imports): used by scripts/fetch-data.mjs and src/lib/live-store.js.

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

const num = (v) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const iso = (v) => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

const https = (v) => (typeof v === 'string' && v.startsWith('https://') ? v : null)

export const OFFLINE_LIVE = Object.freeze({
  isLive: false, title: null, game: null, viewers: null, startedAt: null, thumbnail: null,
})

/** Twitch's auto-refreshing preview frame for a live channel. */
export const liveThumbnailUrl = (login) =>
  `https://static-cdn.jtvnw.net/previews-ttv/live_user_${String(login).toLowerCase()}-640x360.jpg`

function gameName(game) {
  if (typeof game === 'string') return str(game)
  return str(game?.displayName) ?? str(game?.name)
}

/**
 * IVR /v2/twitch/user response (an array, or a single user object) →
 * { user, live, lastBroadcast }. lastBroadcast is null when IVR does not report one.
 * The live `stream` object is read defensively: its exact shape is not documented.
 */
export function normalizeIvrUser(json) {
  const u = Array.isArray(json) ? json[0] : json
  if (!u || typeof u !== 'object' || !(u.id || u.login)) throw new Error('IVR: user not found')

  const login = str(u.login)?.toLowerCase() ?? null
  const s = u.stream && typeof u.stream === 'object' ? u.stream : null
  const live = s
    ? {
        isLive: true,
        title: str(s.title),
        game: gameName(s.game),
        viewers: num(s.viewersCount ?? s.viewers ?? s.viewerCount),
        startedAt: iso(s.createdAt ?? s.startedAt),
        thumbnail: login ? liveThumbnailUrl(login) : null,
      }
    : { ...OFFLINE_LIVE }

  const lb = u.lastBroadcast && typeof u.lastBroadcast === 'object' ? u.lastBroadcast : null

  return {
    user: {
      id: u.id != null ? String(u.id) : null,
      login,
      displayName: str(u.displayName) ?? str(u.login),
      followers: num(u.followers),
      avatar: https(u.logo),
      banner: https(u.banner),
      bio: str(u.bio),
      isAffiliate: Boolean(u.roles?.isAffiliate),
      isPartner: Boolean(u.roles?.isPartner),
    },
    live,
    lastBroadcast: lb ? { title: str(lb.title), startedAt: iso(lb.startedAt) } : null,
  }
}

/** shields.io /twitch/status/<login>.json → { isLive }. Throws on anything but live/offline. */
export function normalizeShieldsStatus(json) {
  const m = String(json?.message ?? json?.value ?? '').trim().toLowerCase()
  if (m === 'live') return { isLive: true }
  if (m === 'offline') return { isLive: false }
  throw new Error(`shields.io: unexpected status "${m.slice(0, 40)}"`)
}

const UPTIME = /^\d+\s+(?:day|hour|minute|second)s?(?:,?\s+\d+\s+(?:day|hour|minute|second)s?)*$/i

/** DecAPI /twitch/uptime/<login> plain text → { isLive }. Throws on error messages. */
export function normalizeDecapiUptime(text) {
  const t = String(text ?? '').trim()
  if (/\bis offline\b/i.test(t)) return { isLive: false }
  if (UPTIME.test(t)) return { isLive: true }
  throw new Error('DecAPI: unexpected uptime response')
}
