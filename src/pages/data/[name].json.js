// Publishes the generated data at /data/<name>.json. The next build's fetch-data script falls back
// to these files when a source is down, so the site keeps its last good data without committing it.
import { getData } from '../../lib/data.js'

const NAMES = ['twitch', 'discord', 'bluesky', 'youtube', 'x', 'meta']

export function getStaticPaths() {
  return NAMES.map((name) => ({ params: { name } }))
}

export function GET({ params }) {
  return new Response(JSON.stringify(getData(params.name)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
