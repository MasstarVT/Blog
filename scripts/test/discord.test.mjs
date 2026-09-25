import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeInvite, discordIconUrl } from '../../src/lib/normalize/discord.mjs'

const json = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

test('Discord invite (real response)', () => {
  assert.deepEqual(normalizeInvite(json('discord-invite.json'), { invite: 'EgSGhrVqQw' }), {
    guildId: '1222593381981618226',
    name: "Mass's Hideout",
    iconUrl: 'https://cdn.discordapp.com/icons/1222593381981618226/53cc328a78bfd77b6d5ca8f53de1962e.png?size=128',
    members: 48,
    online: 18,
    inviteUrl: 'https://discord.gg/EgSGhrVqQw',
  })
})

test('Discord icon URL: animated icons are gif, missing icons are null', () => {
  assert.equal(discordIconUrl('1', 'a_0123abcd'), 'https://cdn.discordapp.com/icons/1/a_0123abcd.gif?size=128')
  assert.equal(discordIconUrl('1', 'abcdef', 64), 'https://cdn.discordapp.com/icons/1/abcdef.png?size=64')
  assert.equal(discordIconUrl('1', null), null)
  assert.equal(discordIconUrl('1', '../evil'), null)
})

test('Discord invite without a guild throws; counts are optional', () => {
  assert.throws(() => normalizeInvite({ code: 10006, message: 'Unknown Invite' }), /no guild/)
  const r = normalizeInvite({ code: 'abc', guild: { id: 5, name: 'G', icon: null } })
  assert.deepEqual(r, { guildId: '5', name: 'G', iconUrl: null, members: null, online: null, inviteUrl: 'https://discord.gg/abc' })
})
