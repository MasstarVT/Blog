// Empty shapes for every generated data file. This is the CONTRACT between
// scripts/fetch-data.mjs (writer) and the site (reader): src/lib/data.js merges
// src/data/generated/<name>.json over these, so the site builds with no data at all.
//
// Status values: 'ok' | 'stale' | 'empty' | 'skipped:<reason>'
//
// Shapes of list items:
//   ScheduleSegment { id, title, category|null, start (ISO UTC), end (ISO UTC|null), recurring: bool, canceled: bool }
//   TwitchVideo     { id, type: 'archive'|'highlight'|'upload', title, url, thumbnail|null, publishedAt, durationSec, views }
//   TwitchClip      { id, title, url, thumbnail|null, createdAt, durationSec, views, creator|null }
//   BlueskyPost     { uri, url, createdAt, isRepost, author: { handle, displayName, avatar|null },
//                     segments: [{ text, href? }], images: [{ thumb, full, alt }],
//                     external: { uri, title, description, thumb|null }|null, counts: { likes, reposts, replies } }
//   XPost           { id, url, createdAt|null, text|null, authorName|null, authorHandle, richness: 'api'|'oembed'|'link' }
//   YouTubeVideo    { id, title, url, thumbnail, publishedAt }

import { site } from '../config/site.mjs'

export const defaults = {
  twitch: {
    fetchedAt: null,
    status: {},
    user: {
      id: site.twitch.id,
      login: site.twitch.login,
      displayName: site.name,
      followers: null,
      avatar: null,
      banner: null,
      bio: null,
      isAffiliate: false,
      isPartner: false,
    },
    live: { isLive: false, title: null, game: null, viewers: null, startedAt: null, thumbnail: null },
    lastBroadcast: { title: null, startedAt: null },
    schedule: { source: 'none', vacation: null, segments: [] },
    videos: [],
    clips: [],
  },
  discord: {
    fetchedAt: null,
    status: 'empty',
    guildId: site.discord.guildId,
    name: null,
    iconUrl: null,
    members: null,
    online: null,
    inviteUrl: `https://discord.gg/${site.discord.invite}`,
  },
  bluesky: {
    fetchedAt: null,
    status: 'empty',
    handle: site.bluesky.handle,
    profileUrl: `https://bsky.app/profile/${site.bluesky.handle}`,
    profile: { displayName: null, avatar: null },
    posts: [],
  },
  youtube: {
    configured: false,
    fetchedAt: null,
    status: 'skipped:not-configured',
    channelUrl: null,
    videos: [],
  },
  x: {
    fetchedAt: null,
    status: 'empty',
    // 'api' when the optional X API provider supplied `posts`, 'curated' when only `featured` exists, else 'none'
    source: 'none',
    profileUrl: `https://x.com/${site.x.handle}`,
    posts: [], // latest posts from the X API provider (optional)
    featured: [], // hand-picked posts from src/data/x-posts.json, checked via oEmbed
  },
  // hash: sha256 of all generated data minus fetchedAt/status; postsHash: sha256 of published post ids;
  // commit: GITHUB_SHA the site was built from (null locally)
  meta: { builtAt: null, hash: null, postsHash: null, sources: {}, commit: null },
}
