import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(120),
      description: z.string().max(300).default(''),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]).transform((tags) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      // Link to a related VOD / clip / YouTube video, shown at the top of the post
      vod: z.url().optional(),
      draft: z.boolean().default(false),
    }),
})

export const collections = { posts }
