import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://blog.masstar.org',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // Collapse whitespace but keep the single spaces authored markup relies on
  compressHTML: true,
  integrations: [
    react(),
    sitemap({ filter: (page) => !page.includes('/data/') }),
  ],
  prefetch: { defaultStrategy: 'hover' },
  markdown: {
    shikiConfig: { theme: 'github-dark' },
  },
  server: { port: 4321 },
})
