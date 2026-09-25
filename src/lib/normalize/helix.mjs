// Normalizers for Twitch Helix responses (schedule, videos, clips). Pure, no I/O.

const DAY_MS = 86_400_000
const FALLBACK_TITLE = 'Stream'
const VIDEO_TYPES = new Set(['archive', 'highlight', 'upload'])

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const iso = (v) => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

const byStart = (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)
const newestFirst = (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')

/** '3h2m1s' → 10921. Also accepts '45s', '1m', plain numbers. null when unparseable. */
export function parseTwitchDuration(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i.exec(String(value ?? '').trim())
  if (!m || !(m[1] || m[2] || m[3])) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Math.round(Number(m[3] ?? 0))
}

/**
 * Fill Helix's `%{width}x%{height}` template. Empty strings and the `_404` "still processing"
 * placeholder become null so the site can show its own fallback.
 */
export function helixThumbnail(url, width = 640, height = 360) {
  if (typeof url !== 'string' || !url.trim() || url.includes('/_404/') || url.includes('404_processing')) return null
  const out = url
    .replace('%{width}', width).replace('%{height}', height)
    .replace('{width}', width).replace('{height}', height)
  return out.startsWith('https://') ? out : null
}

/** An empty but successful Helix schedule (Helix answers 404 when no schedule exists). */
export const emptyHelixSchedule = () => ({ source: 'helix', vacation: null, segments: [] })

/**
 * GET /helix/schedule → { source: 'helix', vacation, segments }. Drops segments that already
 * ended or start beyond `days` from `now`, sorted by start.
 */
export function normalizeSchedule(json, { now = new Date(), days = 14, limit = 25 } = {}) {
  const data = json?.data ?? {}
  const nowMs = new Date(now).getTime()
  const horizon = nowMs + days * DAY_MS

  const segments = (Array.isArray(data.segments) ? data.segments : [])
    .map((seg) => ({
      id: String(seg?.id ?? ''),
      title: str(seg?.title) ?? FALLBACK_TITLE,
      category: str(seg?.category?.name),
      start: iso(seg?.start_time),
      end: iso(seg?.end_time),
      recurring: Boolean(seg?.is_recurring),
      canceled: seg?.canceled_until != null,
    }))
    .filter((s) => s.id && s.start && Date.parse(s.end ?? s.start) > nowMs && Date.parse(s.start) < horizon)
    .sort(byStart)
    .slice(0, limit)

  const v = data.vacation
  const vacation = v?.start_time && v?.end_time && Date.parse(v.end_time) > nowMs
    ? { start: iso(v.start_time), end: iso(v.end_time) }
    : null

  return { source: 'helix', vacation, segments }
}

/** GET /helix/videos → TwitchVideo[] (Helix already sorts by time when asked). */
export function normalizeVideos(json) {
  return (Array.isArray(json?.data) ? json.data : [])
    .filter((v) => v?.id && typeof v.url === 'string' && v.url.startsWith('https://'))
    .map((v) => ({
      id: String(v.id),
      type: VIDEO_TYPES.has(v.type) ? v.type : 'archive',
      title: str(v.title) ?? 'Untitled',
      url: v.url,
      thumbnail: helixThumbnail(v.thumbnail_url),
      publishedAt: iso(v.published_at ?? v.created_at),
      durationSec: parseTwitchDuration(v.duration),
      views: num(v.view_count) ?? 0,
    }))
}

/** GET /helix/clips → TwitchClip[] in the order Helix returned them. */
export function normalizeClips(json) {
  return (Array.isArray(json?.data) ? json.data : [])
    .filter((c) => c?.id && typeof c.url === 'string' && c.url.startsWith('https://'))
    .map((c) => {
      const d = Number(c.duration)
      return {
        id: String(c.id),
        title: str(c.title) ?? 'Untitled clip',
        url: c.url,
        thumbnail: helixThumbnail(c.thumbnail_url),
        createdAt: iso(c.created_at),
        durationSec: Number.isFinite(d) ? Math.round(d * 10) / 10 : null,
        views: num(c.view_count) ?? 0,
        creator: str(c.creator_name),
      }
    })
}

/**
 * Recent clips newest first. When there are fewer than `min`, top up with the most-viewed
 * all-time clips (de-duplicated) until `min` is reached.
 */
export function mergeClips(recent, allTime = [], min = 4) {
  const out = [...recent].sort(newestFirst)
  if (out.length >= min) return out
  const seen = new Set(out.map((c) => c.id))
  for (const clip of allTime) {
    if (out.length >= min) break
    if (seen.has(clip.id)) continue
    seen.add(clip.id)
    out.push(clip)
  }
  return out.sort(newestFirst)
}
