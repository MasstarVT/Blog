// Normalizers for the public Bluesky AppView (app.bsky.feed.getAuthorFeed, app.bsky.actor.getProfile).
// Post text becomes plain `segments` ([{ text, href? }]); HTML is never produced. Only https:
// links survive; anything else is rendered as plain text.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const REPOST = 'app.bsky.feed.defs#reasonRepost'
const DID = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Returns the URL string when it parses as an https: URL, else null. */
export function safeHttps(value) {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function facetHref(features) {
  for (const f of Array.isArray(features) ? features : []) {
    const type = f?.$type ?? ''
    if (type.endsWith('#link')) {
      const href = safeHttps(f.uri)
      if (href) return href
    } else if (type.endsWith('#mention') && typeof f.did === 'string' && DID.test(f.did)) {
      return `https://bsky.app/profile/${f.did}`
    } else if (type.endsWith('#tag') && typeof f.tag === 'string' && f.tag.trim() && !/\s/.test(f.tag)) {
      return `https://bsky.app/hashtag/${encodeURIComponent(f.tag.replace(/^#/, ''))}`
    }
  }
  return null
}

/**
 * Split post text into [{ text, href? }] using richtext facets. Facet offsets index into the
 * UTF-8 bytes of the text, so slicing happens on the encoded bytes.
 */
export function facetSegments(text, facets) {
  const bytes = encoder.encode(String(text ?? ''))
  const ranges = (Array.isArray(facets) ? facets : [])
    .map((f) => {
      const idx = f?.index ?? f?.byteSlice ?? {}
      return { start: idx.byteStart, end: idx.byteEnd, href: facetHref(f?.features) }
    })
    .filter((r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= bytes.length)
    .sort((a, b) => a.start - b.start)

  const segments = []
  const push = (t, href) => {
    if (!t) return
    const last = segments[segments.length - 1]
    if (!href && last && !last.href) last.text += t
    else segments.push(href ? { text: t, href } : { text: t })
  }

  let pos = 0
  for (const r of ranges) {
    if (r.start < pos) continue // overlapping facet
    push(decoder.decode(bytes.subarray(pos, r.start)))
    push(decoder.decode(bytes.subarray(r.start, r.end)), r.href)
    pos = r.end
  }
  push(decoder.decode(bytes.subarray(pos)))
  return segments
}

function images(list) {
  return (Array.isArray(list) ? list : [])
    .map((img) => ({ thumb: safeHttps(img?.thumb), full: safeHttps(img?.fullsize) ?? safeHttps(img?.thumb), alt: String(img?.alt ?? '') }))
    .filter((img) => img.thumb)
}

function external(ext) {
  const uri = safeHttps(ext?.uri)
  if (!uri) return null
  return { uri, title: String(ext.title ?? ''), description: String(ext.description ?? ''), thumb: safeHttps(ext.thumb) }
}

function embedParts(embed) {
  const type = embed?.$type ?? ''
  if (type === 'app.bsky.embed.images#view') return { images: images(embed.images), external: null }
  if (type === 'app.bsky.embed.external#view') return { images: [], external: external(embed.external) }
  if (type === 'app.bsky.embed.video#view') {
    const thumb = safeHttps(embed.thumbnail)
    return { images: thumb ? [{ thumb, full: thumb, alt: String(embed.alt ?? '') }] : [], external: null }
  }
  if (type === 'app.bsky.embed.recordWithMedia#view') return embedParts(embed.media)
  return { images: [], external: null }
}

/** One feed item ({ post, reason? }) → BlueskyPost. */
export function normalizePost(item, handle = null) {
  const p = item?.post ?? item
  const authorHandle = str(p?.author?.handle) ?? handle
  const rkey = String(p.uri).split('/').pop()
  const record = p.record ?? {}
  const { images: imgs, external: ext } = embedParts(p.embed)
  return {
    uri: p.uri,
    url: `https://bsky.app/profile/${authorHandle}/post/${rkey}`,
    createdAt: str(record.createdAt) ?? str(p.indexedAt),
    isRepost: item?.reason?.$type === REPOST,
    author: {
      handle: authorHandle,
      displayName: str(p.author?.displayName) ?? authorHandle,
      avatar: safeHttps(p.author?.avatar),
    },
    segments: facetSegments(record.text, record.facets),
    images: imgs,
    external: ext,
    counts: { likes: count(p.likeCount), reposts: count(p.repostCount), replies: count(p.replyCount) },
  }
}

/** getAuthorFeed response → BlueskyPost[] (de-duplicated by uri, feed order kept). */
export function normalizeFeed(json, handle = null, { limit = Infinity } = {}) {
  const seen = new Set()
  const posts = []
  for (const item of Array.isArray(json?.feed) ? json.feed : []) {
    const uri = item?.post?.uri
    if (typeof uri !== 'string' || !uri.startsWith('at://') || seen.has(uri)) continue
    seen.add(uri)
    posts.push(normalizePost(item, handle))
    if (posts.length >= limit) break
  }
  return posts
}

/** getProfile response → { displayName, avatar }. */
export function normalizeProfile(json) {
  if (!json || typeof json !== 'object' || !(json.did || json.handle)) throw new Error('Bluesky: profile not found')
  return { displayName: str(json.displayName) ?? str(json.handle), avatar: safeHttps(json.avatar) }
}
