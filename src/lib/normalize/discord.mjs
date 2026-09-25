// Normalizer for the public Discord invite endpoint (GET /api/v10/invites/<code>?with_counts=true).

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Guild icon CDN URL; animated icons (hash starting with `a_`) are GIFs. */
export function discordIconUrl(guildId, icon, size = 128) {
  if (!guildId || typeof icon !== 'string' || !/^(?:a_)?[0-9a-f]+$/i.test(icon)) return null
  const ext = icon.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=${size}`
}

/** Invite response → { guildId, name, iconUrl, members, online, inviteUrl }. */
export function normalizeInvite(json, { invite } = {}) {
  const g = json?.guild
  if (!g?.id) throw new Error('Discord: invite has no guild (expired or invalid?)')
  const code = str(invite) ?? str(json.code)
  return {
    guildId: String(g.id),
    name: str(g.name),
    iconUrl: discordIconUrl(String(g.id), g.icon),
    members: num(json.approximate_member_count),
    online: num(json.approximate_presence_count),
    inviteUrl: code ? `https://discord.gg/${code}` : null,
  }
}
