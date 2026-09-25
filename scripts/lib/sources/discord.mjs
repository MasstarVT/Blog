// Discord: the public invite endpoint gives guild name, icon and approximate counts (no auth).
import { normalizeInvite } from '../../../src/lib/normalize/discord.mjs'
import { skip } from '../run-source.mjs'

export async function fetchDiscord({ http, site, raw = () => {} }) {
  const invite = site.discord?.invite
  if (!invite) skip('not-configured')
  const json = await http.fetchJson(`https://discord.com/api/v10/invites/${encodeURIComponent(invite)}?with_counts=true`)
  raw('discord-invite', json)
  return normalizeInvite(json, { invite })
}
