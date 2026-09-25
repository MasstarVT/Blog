import { getCollection } from 'astro:content'
import { readingTime, slugify } from './format.mjs'

/**
 * Posts visible on this build. Production hides drafts and posts whose pubDate is still in the
 * future (the scheduled rebuild publishes them once they're due); dev shows everything.
 */
export async function getPublishedPosts() {
  const now = Date.now()
  const posts = await getCollection('posts', ({ data }) =>
    import.meta.env.DEV ? true : !data.draft && data.pubDate.getTime() <= now,
  )
  return posts
    .map((post) => ({ ...post, minutes: readingTime(post.body ?? '') }))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime())
}

/** [{ tag, slug, count }] sorted by count, then name */
export function getTags(posts) {
  const counts = new Map()
  for (const post of posts) for (const tag of post.data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts]
    .map(([tag, count]) => ({ tag, slug: slugify(tag), count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export const postUrl = (post) => `/blog/${post.id}/`
export const tagUrl = (tag) => `/tags/${slugify(tag)}/`
