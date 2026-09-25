// Bluesky: public AppView author feed + profile (no auth, CORS open).
import { normalizeFeed, normalizeProfile } from '../../../src/lib/normalize/bluesky.mjs'
import { skip } from '../run-source.mjs'

const XRPC = 'https://public.api.bsky.app/xrpc'

export async function fetchBluesky({ http, site, raw = () => {} }) {
  const handle = site.bluesky?.handle
  if (!handle) skip('not-configured')
  const maxPosts = site.bluesky.maxPosts ?? 5
  // The posts_no_replies filter is applied after `limit`, so ask for a few extra.
  const limit = String(Math.min(100, Math.max(maxPosts * 3, 10)))

  const [feed, profile] = await Promise.allSettled([
    http.fetchJson(`${XRPC}/app.bsky.feed.getAuthorFeed?${new URLSearchParams({ actor: handle, limit, filter: 'posts_no_replies' })}`),
    http.fetchJson(`${XRPC}/app.bsky.actor.getProfile?${new URLSearchParams({ actor: handle })}`),
  ])
  if (feed.status === 'rejected') throw feed.reason
  raw('bluesky-feed', feed.value)
  const posts = normalizeFeed(feed.value, handle, { limit: maxPosts })

  let prof
  if (profile.status === 'fulfilled') {
    raw('bluesky-profile', profile.value)
    prof = normalizeProfile(profile.value)
  } else {
    // Profile endpoint down: the author block of an own post carries the same fields.
    const own = posts.find((p) => !p.isRepost)?.author
    if (!own) throw profile.reason
    prof = { displayName: own.displayName, avatar: own.avatar }
  }

  return { handle, profileUrl: `https://bsky.app/profile/${handle}`, profile: prof, posts }
}
