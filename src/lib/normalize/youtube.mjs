// Normalizers for YouTube: the channel Atom feed (regex-parsed, no XML dependency) and the
// optional Data API playlistItems.list fallback.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeXmlEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

function tag(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)
  if (!m) return null
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1])
  return (cdata ? cdata[1] : decodeXmlEntities(m[1])).trim()
}

const attr = (xml, re) => {
  const m = re.exec(xml)
  return m ? decodeXmlEntities(m[1]) : null
}

const iso = (v) => {
  const t = Date.parse(v ?? '')
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`
export const fallbackThumbnail = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

/** UC… channel id → UU… uploads playlist id. */
export const uploadsPlaylistId = (channelId) => `UU${String(channelId).slice(2)}`

/** Channel Atom feed XML → YouTubeVideo[] (feed order: newest first). */
export function parseYouTubeFeed(xml, { limit = Infinity } = {}) {
  const text = String(xml ?? '')
  if (!/<feed\b/.test(text)) throw new Error('YouTube: response is not an Atom feed')
  const videos = []
  for (const [, entry] of text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const id = tag(entry, 'yt:videoId')
    if (!id || !VIDEO_ID.test(id)) continue
    const link = attr(entry, /<link\b[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/)
    const thumb = attr(entry, /<media:thumbnail\b[^>]*\burl="([^"]+)"/)
    videos.push({
      id,
      title: tag(entry, 'title') ?? tag(entry, 'media:title') ?? '',
      url: link?.startsWith('https://www.youtube.com/') ? link : watchUrl(id),
      thumbnail: thumb?.startsWith('https://') ? thumb : fallbackThumbnail(id),
      publishedAt: iso(tag(entry, 'published')),
    })
    if (videos.length >= limit) break
  }
  return videos
}

/** Data API playlistItems.list (part=snippet,contentDetails) → YouTubeVideo[]. */
export function normalizePlaylistItems(json, { limit = Infinity } = {}) {
  const videos = []
  for (const item of Array.isArray(json?.items) ? json.items : []) {
    const s = item?.snippet ?? {}
    const id = s.resourceId?.videoId ?? item?.contentDetails?.videoId
    if (!id || !VIDEO_ID.test(id)) continue
    // private/deleted uploads come back without thumbnails
    const thumbs = s.thumbnails ?? {}
    const best = thumbs.maxres ?? thumbs.standard ?? thumbs.high ?? thumbs.medium ?? thumbs.default
    if (!best) continue
    videos.push({
      id,
      title: String(s.title ?? ''),
      url: watchUrl(id),
      thumbnail: typeof best.url === 'string' && best.url.startsWith('https://') ? best.url : fallbackThumbnail(id),
      publishedAt: iso(item.contentDetails?.videoPublishedAt ?? s.publishedAt),
    })
    if (videos.length >= limit) break
  }
  return videos
}
