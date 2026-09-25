// Freshen build-time social data in the browser (both APIs allow cross-origin requests):
// Discord member/online counts and the Bluesky feed. Failures keep the build-time content.
// Also wires the click-to-load TikTok creator embed.
import { normalizeFeed } from '../lib/normalize/bluesky.mjs'
import { formatCount } from '../lib/format.mjs'

const TIMEOUT_MS = 8000

async function cachedJson(key, url, maxAgeMs) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.data
  } catch {}
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(String(res.status))
  const data = await res.json()
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })) } catch {}
  return data
}

async function refreshDiscord(card) {
  const invite = card.dataset.invite
  const data = await cachedJson(`masstar:discord:${invite}`, `https://discord.com/api/v10/invites/${encodeURIComponent(invite)}?with_counts=true`, 5 * 60_000)
  const set = (sel, value) => { const el = card.querySelector(sel); if (el && value != null) el.textContent = value }
  set('[data-discord-online]', formatCount(data.approximate_presence_count))
  set('[data-discord-members]', formatCount(data.approximate_member_count))
  set('[data-discord-name]', data.guild?.name)
}

// ── Bluesky ─────────────────────────────────────────────────────────────
const safeHttps = (url) => { try { return new URL(url).protocol === 'https:' ? url : null } catch { return null } }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v)
  node.append(...children.filter((c) => c != null))
  return node
}
const extLink = (href, attrs, ...children) => el('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow', ...attrs }, ...children)
const dateText = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))

function renderBskyPost(p) {
  const text = el('p', { class: 'post-text' }, ...p.segments.map((s) => {
    const href = s.href && safeHttps(s.href)
    return href ? extLink(href, {}, s.text) : s.text
  }))
  const shown = p.images.slice(0, 4)
  const images = shown.length
    ? el('div', { class: 'post-images' }, ...shown.map((img, i) =>
      extLink(safeHttps(img.full), {}, el('img', {
        src: safeHttps(img.thumb), alt: img.alt || `Image ${i + 1} of ${shown.length} attached to this post`,
        loading: 'lazy', referrerpolicy: 'no-referrer',
      }))))
    : null
  const ext = p.external && safeHttps(p.external.uri)
    ? extLink(p.external.uri, { class: 'post-external' },
      p.external.thumb ? el('img', { src: safeHttps(p.external.thumb), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      el('span', {}, el('strong', {}, p.external.title || p.external.uri), el('span', {}, p.external.description ?? '')))
    : null
  return el('li', { class: 'feed-card bsky-post', 'data-uri': p.uri },
    p.isRepost ? el('span', { class: 'feed-repost' }, '⟲ Reposted') : null,
    el('div', { class: 'feed-head' },
      p.author.avatar ? el('img', { class: 'feed-avatar', src: safeHttps(p.author.avatar), alt: '', width: 38, height: 38, loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      el('span', { class: 'feed-author' },
        el('span', { class: 'feed-name' }, p.author.displayName || p.author.handle),
        el('span', { class: 'feed-handle' }, `@${p.author.handle}`)),
      el('span', { class: 'feed-meta' }, extLink(safeHttps(p.url), {}, el('time', { datetime: p.createdAt }, dateText(p.createdAt))))),
    text, images, ext,
    el('div', { class: 'post-counts' },
      el('span', { 'aria-hidden': 'true' }, `♡ ${p.counts.likes}`),
      el('span', { 'aria-hidden': 'true' }, `⟲ ${p.counts.reposts}`),
      el('span', { 'aria-hidden': 'true' }, `💬 ${p.counts.replies}`),
      el('span', { class: 'sr-only' }, `${p.counts.likes} likes, ${p.counts.reposts} reposts, ${p.counts.replies} replies`)))
}

async function refreshBluesky(feed) {
  const handle = feed.dataset.handle
  const limit = Number(feed.dataset.limit) || 5
  // Like the build: the API applies posts_no_replies after `limit`, so over-fetch and trim
  const fetchLimit = Math.min(100, Math.max(limit * 3, 10))
  const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${fetchLimit}&filter=posts_no_replies`
  const posts = normalizeFeed(await cachedJson(`masstar:bsky:${handle}:${fetchLimit}`, url, 10 * 60_000), handle, { limit })
  const list = feed.querySelector('[data-bsky-list]')
  if (!list || !posts.length || posts.length < list.children.length) return
  const current = [...list.children].map((li) => li.dataset.uri).join('|')
  if (current === posts.map((p) => p.uri).join('|')) return
  list.replaceChildren(...posts.map(renderBskyPost))
  feed.querySelector('.empty-state')?.remove()
}

// ── TikTok ──────────────────────────────────────────────────────────────
function loadTikTok(card) {
  const handle = card.dataset.handle
  const quote = el('blockquote', {
    class: 'tiktok-embed', cite: `https://www.tiktok.com/@${handle}`, 'data-unique-id': handle,
    'data-embed-type': 'creator', style: 'max-width: 780px; min-width: 288px;',
  }, el('section', {}, extLink(`https://www.tiktok.com/@${handle}`, {}, `@${handle}`)))
  card.replaceChildren(quote)
  card.tabIndex = -1
  card.focus()
  document.body.append(el('script', { src: 'https://www.tiktok.com/embed.js', async: '' }))
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-tiktok-load]')
  if (btn) loadTikTok(btn.closest('[data-tiktok-card]'))
})

document.addEventListener('astro:page-load', () => {
  document.querySelectorAll('[data-discord-card]').forEach((card) => refreshDiscord(card).catch(() => {}))
  document.querySelectorAll('[data-bsky-feed]').forEach((feed) => refreshBluesky(feed).catch(() => {}))
})
