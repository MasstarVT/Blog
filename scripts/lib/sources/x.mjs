// X (Twitter). There is no free read API, so in order of preference:
//   1. X API v2 with OAuth 1.0a user keys (X_API_KEY/SECRET + X_ACCESS_TOKEN/SECRET) → `posts`
//   2. hand-picked URLs in src/data/x-posts.json checked through the official oEmbed endpoint → `featured`
//   3. nothing configured → skipped (the site shows the follow card)
// Never uses the syndication CDN or timeline-profile endpoints (against X's terms).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseXPostUrl, parseOEmbed, normalizeApiTweets, linkPost } from '../../../src/lib/normalize/x.mjs'
import { HttpError } from '../http.mjs'
import { oauth1Header, encodeQuery } from '../oauth1.mjs'
import { ROOT, errorMessage, skip } from '../run-source.mjs'

export function xCredentials(env = {}) {
  const c = {
    apiKey: env.X_API_KEY?.trim(),
    apiSecret: env.X_API_SECRET?.trim(),
    accessToken: env.X_ACCESS_TOKEN?.trim(),
    accessSecret: env.X_ACCESS_SECRET?.trim(),
  }
  return Object.values(c).every(Boolean) ? c : null
}

/** Unique post references from x-posts.json (strings or { url }); invalid entries are ignored. */
export async function readCurated(file = join(ROOT, 'src', 'data', 'x-posts.json')) {
  let json
  try {
    json = JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') return []
    throw new Error(`x-posts.json is not valid JSON: ${err.message}`)
  }
  const seen = new Set()
  const refs = []
  for (const entry of Array.isArray(json?.posts) ? json.posts : []) {
    const ref = parseXPostUrl(typeof entry === 'string' ? entry : entry?.url)
    if (!ref || seen.has(ref.id)) continue
    seen.add(ref.id)
    refs.push(ref)
  }
  return refs
}

async function fetchFeatured({ http, refs, handle, raw }) {
  const featured = []
  for (const ref of refs) {
    try {
      const json = await http.fetchJson(`https://publish.x.com/oembed?url=${encodeURIComponent(ref.url)}&omit_script=true&dnt=true`)
      raw(`x-oembed-${ref.id}`, json)
      featured.push(parseOEmbed(json, ref.url))
    } catch (err) {
      // 404/410: the post was deleted → drop it.
      if (err instanceof HttpError && (err.status === 404 || err.status === 410)) continue
      // Anything else (protected, rate limited, outage): a bare link. Earlier oEmbed text is never
      // reused, so text from a post that is no longer public is not republished.
      featured.push(linkPost(ref, handle))
    }
  }
  return featured
}

async function fetchApiPosts({ http, creds, site, handle, raw }) {
  // Signed requests are not retried: a replayed nonce would be rejected anyway.
  const signed = (url) => http.fetchJson(url, {
    retries: 0,
    headers: {
      Authorization: oauth1Header({
        method: 'GET', url,
        consumerKey: creds.apiKey, consumerSecret: creds.apiSecret,
        token: creds.accessToken, tokenSecret: creds.accessSecret,
      }),
    },
  })

  let userId = site.x.userId ? String(site.x.userId) : null
  let authorName = null
  if (!userId) {
    const user = await signed(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`)
    raw('x-api-user', user)
    userId = user?.data?.id ?? null
    authorName = user?.data?.name ?? null
    if (!userId) throw new Error('X API: user lookup returned no id')
  }

  const max = site.x.maxPosts ?? 5
  // Always the latest page (no since_id) so deleted posts drop off.
  const query = encodeQuery({ max_results: String(Math.min(100, Math.max(5, max))), exclude: 'replies,retweets', 'tweet.fields': 'created_at' })
  const json = await signed(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${query}`)
  raw('x-api-tweets', json)
  return normalizeApiTweets(json, handle, { authorName, limit: max })
}

/**
 * Build x.json data. ctx: { http, env, site, raw, report, curatedFile? }
 * Provider order: API → curated → none. A failing API falls back to the curated posts (the error
 * is still reported); it only throws (→ stale/empty via runPart) when there is nothing to fall back to.
 */
export async function fetchX({ http, env = {}, site, raw = () => {}, report, curatedFile }) {
  const handle = site.x?.handle
  if (!handle) skip('not-configured')
  const creds = xCredentials(env)
  const refs = await readCurated(curatedFile)
  if (!creds && !refs.length) skip('not-configured')

  const featured = refs.length ? await fetchFeatured({ http, refs, handle, raw }) : []
  let posts = []
  if (creds) {
    try {
      posts = await fetchApiPosts({ http, creds, site, handle, raw })
    } catch (err) {
      if (!featured.length) throw err
      report?.({ name: 'x', status: 'ok', error: `X API failed, using curated posts: ${errorMessage(err)}` })
    }
  }
  const source = posts.length ? 'api' : featured.length ? 'curated' : 'none'
  return { source, profileUrl: `https://x.com/${handle}`, posts, featured }
}
