import rss from '@astrojs/rss'
import { getPublishedPosts, postUrl } from '../lib/posts.js'
import { site } from '../config/site.mjs'

export async function GET(context) {
  const posts = await getPublishedPosts()
  return rss({
    title: `${site.name} — Blog`,
    description: site.description,
    site: context.site,
    items: posts
      .filter((p) => !p.data.draft)
      .map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        categories: post.data.tags,
        link: postUrl(post),
      })),
    customData: `<language>en-us</language>`,
  })
}
