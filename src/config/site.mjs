// Single source of truth for handles, IDs, links and feature flags.
// Plain ESM (no TypeScript) so the Node data scripts can import it too.
// Set a value to null to hide that section of the site.

export const site = {
  url: 'https://blog.masstar.org',
  mainSite: 'https://masstar.org',
  name: 'MasstarVT',
  title: 'MasstarVT — Blog & Stream Hub',
  description: 'Streams, schedule, clips, posts and everything MasstarVT in one place.',
  author: 'MasstarVT',
  email: 'Mass@Masstar.org',
  avatar: '/PFP.jpg',
  locale: 'en-US',

  twitch: { login: 'masstarvt', id: '139905616' },
  discord: { invite: 'EgSGhrVqQw', guildId: '1222593381981618226' },
  bluesky: { handle: 'mass.masstar.org', maxPosts: 5 },
  x: {
    handle: 'MasstarVT',
    // Numeric user id, only needed for the optional X API provider (looked up automatically when null).
    userId: null,
    // Official profile-timeline widget; falls back to curated posts / follow card if it fails to render.
    timelineEmbed: true,
    maxPosts: 5,
  },
  // e.g. 'UCxxxxxxxxxxxxxxxxxxxxxx' (the UC… channel id, not the @handle)
  youtube: { channelId: null, handle: null },
  // e.g. 'masstarvt' (without the @)
  tiktok: { handle: null },

  live: { pollMs: 90_000 },
  intro: { enabled: true },

  hero: {
    badges: ['Variety Streamer', 'Creative Dev', 'Community Builder'],
    description: 'Content Creator • VTuber • Developer',
    tagline: 'Streams, schedule, clips and stories — everything from my corner of the internet, in one place.',
  },
  staticMetrics: [{ value: '150+', label: 'Streams hosted' }],

  links: [
    { key: 'twitch', group: 'content', href: 'https://twitch.tv/masstarvt', icon: 'twitch', title: 'Twitch', description: 'Watch me live stream' },
    { key: 'discord', group: 'content', href: 'https://discord.gg/EgSGhrVqQw', icon: 'discord', title: 'Discord', description: 'Join our community' },
    { key: 'twitter', group: 'content', href: 'https://x.com/MasstarVT', icon: 'x', title: 'Twitter / X', description: 'Latest updates & thoughts' },
    { key: 'bluesky', group: 'content', href: 'https://bsky.app/profile/mass.masstar.org', icon: 'bluesky', title: 'BlueSky', description: 'Another social space' },
    { key: 'email', group: 'content', href: 'mailto:Mass@Masstar.org', icon: 'email', title: 'Email', description: 'Get in touch directly', internal: true },
    { key: 'kofi', group: 'support', href: 'https://ko-fi.com/masstarvt', iconUrl: '/icons/kofi.png', title: 'Ko-fi', description: 'Buy me a coffee' },
    { key: 'throne', group: 'support', href: 'https://throne.com/masstarvt', icon: 'throne', title: 'Throne', description: 'Gift wishlist' },
    { key: 'github', group: 'dev', href: 'https://github.com/MasstarVT', icon: 'github', title: 'GitHub', description: 'Code & projects' },
    { key: 'website', group: 'dev', href: 'https://masstar.org', icon: 'globe', title: 'masstar.org', description: 'My main site' },
  ],
  linkGroups: [
    { key: 'content', title: 'Content Creation', subtitle: 'Catch the latest live shows, highlights, and real-time updates.' },
    { key: 'support', title: 'Support & Donations', subtitle: 'Fuel future streams, tech upgrades, and collaborative events.' },
    { key: 'dev', title: 'Development', subtitle: 'Peek into the code that powers my projects and experiments.' },
  ],
}

export const urls = {
  twitch: `https://twitch.tv/${site.twitch.login}`,
  twitchVideos: `https://www.twitch.tv/${site.twitch.login}/videos`,
  twitchSchedule: `https://www.twitch.tv/${site.twitch.login}/schedule`,
  discordInvite: `https://discord.gg/${site.discord.invite}`,
  bluesky: `https://bsky.app/profile/${site.bluesky.handle}`,
  x: `https://x.com/${site.x.handle}`,
  youtube: site.youtube.channelId
    ? `https://www.youtube.com/channel/${site.youtube.channelId}`
    : site.youtube.handle ? `https://www.youtube.com/@${site.youtube.handle}` : null,
  tiktok: site.tiktok.handle ? `https://www.tiktok.com/@${site.tiktok.handle}` : null,
  twitchICal: `https://api.twitch.tv/helix/schedule/icalendar?broadcaster_id=${site.twitch.id}`,
}
