// Build-time access to the generated social data (src/data/generated/*.json, written by
// scripts/fetch-data.mjs). Missing files fall back to the empty shapes in defaults.mjs,
// so the site always builds — even on a fresh clone with no network.
import { defaults } from '../data/defaults.mjs'

const files = import.meta.glob('../data/generated/*.json', { eager: true, import: 'default' })

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function merge(base, over) {
  if (!isPlainObject(over)) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? merge(base[k], v) : v
  }
  return out
}

/**
 * @param {'twitch'|'discord'|'bluesky'|'youtube'|'x'|'meta'} name
 * @returns {any}
 */
export function getData(name) {
  return merge(defaults[name], files[`../data/generated/${name}.json`])
}

/** The build-time live snapshot handed to islands (they poll for fresh state in the browser). */
export function getLiveSnapshot() {
  const { live, lastBroadcast } = getData('twitch')
  return {
    isLive: Boolean(live.isLive),
    title: live.title,
    game: live.game,
    viewers: live.viewers,
    startedAt: live.startedAt,
    thumbnail: live.thumbnail,
    lastBroadcast,
  }
}

/** Upcoming schedule segments that have not ended yet at build time. */
export function getUpcomingSegments(limit = Infinity, now = Date.now()) {
  const { schedule } = getData('twitch')
  return schedule.segments
    .filter((s) => new Date(s.end ?? s.start).getTime() > now)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit)
}
