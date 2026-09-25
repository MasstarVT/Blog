import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeIvrUser, normalizeShieldsStatus, normalizeDecapiUptime, liveThumbnailUrl } from '../../src/lib/normalize/ivr.mjs'
import { defaults } from '../../src/data/defaults.mjs'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const json = (name) => JSON.parse(fixture(name))
const keys = (o) => Object.keys(o).sort()

test('IVR offline (real response) → user, offline live, lastBroadcast', () => {
  const { user, live, lastBroadcast } = normalizeIvrUser(json('ivr-user-offline.json'))
  assert.deepEqual(keys(user), keys(defaults.twitch.user))
  assert.deepEqual(keys(live), keys(defaults.twitch.live))
  assert.equal(user.id, '139905616')
  assert.equal(user.login, 'masstarvt')
  assert.equal(user.displayName, 'MasstarVT')
  assert.equal(user.followers, 116)
  assert.match(user.avatar, /^https:\/\/static-cdn\.jtvnw\.net\/.+profile_image/)
  assert.match(user.banner, /^https:\/\//)
  assert.equal(user.isAffiliate, true)
  assert.equal(user.isPartner, false)
  assert.deepEqual(live, defaults.twitch.live)
  assert.deepEqual(lastBroadcast, { title: 'Swimming in a new sea with @Urgirlfriendpai', startedAt: '2026-05-15T21:34:32.096Z' })
})

test('IVR live (synthetic) → live snapshot with preview thumbnail', () => {
  const { user, live, lastBroadcast } = normalizeIvrUser(json('ivr-user-live.json'))
  assert.deepEqual(live, {
    isLive: true,
    title: 'Cozy chaos with chat',
    game: 'Just Chatting',
    viewers: 37,
    startedAt: '2026-09-25T17:00:00.000Z',
    thumbnail: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_masstarvt-640x360.jpg',
  })
  assert.equal(user.banner, null, 'non-https banner is dropped')
  assert.equal(lastBroadcast.startedAt, '2026-09-25T17:00:00.123Z')
})

test('IVR stream shape is read defensively', () => {
  const base = { id: '1', login: 'Someone', displayName: '', roles: null }
  const a = normalizeIvrUser({ ...base, stream: { title: '', viewers: '12', game: { name: 'Art' }, startedAt: '2026-01-01T00:00:00Z' } })
  assert.equal(a.live.isLive, true)
  assert.equal(a.live.title, null)
  assert.equal(a.live.viewers, 12)
  assert.equal(a.live.game, 'Art')
  assert.equal(a.live.startedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(a.live.thumbnail, liveThumbnailUrl('someone'))
  assert.equal(a.user.displayName, 'Someone')
  assert.equal(a.user.login, 'someone')
  assert.equal(a.lastBroadcast, null)

  const b = normalizeIvrUser([{ ...base, stream: { game: 'Minecraft', viewersCount: null } }])
  assert.equal(b.live.game, 'Minecraft')
  assert.equal(b.live.viewers, null)
  assert.equal(b.live.startedAt, null)
})

test('IVR unknown user throws', () => {
  assert.throws(() => normalizeIvrUser([]), /user not found/)
  assert.throws(() => normalizeIvrUser(null), /user not found/)
})

test('shields.io status', () => {
  assert.deepEqual(normalizeShieldsStatus(json('shields-status-offline.json')), { isLive: false })
  assert.deepEqual(normalizeShieldsStatus({ label: 'twitch', message: 'live' }), { isLive: true })
  assert.throws(() => normalizeShieldsStatus({ message: 'inaccessible' }), /unexpected status/)
  assert.throws(() => normalizeShieldsStatus(null))
})

test('DecAPI uptime text', () => {
  assert.deepEqual(normalizeDecapiUptime(fixture('decapi-uptime-offline.txt')), { isLive: false })
  assert.deepEqual(normalizeDecapiUptime('1 hour, 2 minutes, 3 seconds'), { isLive: true })
  assert.deepEqual(normalizeDecapiUptime('5 minutes\n'), { isLive: true })
  assert.deepEqual(normalizeDecapiUptime('2 days, 1 hour'), { isLive: true })
  assert.throws(() => normalizeDecapiUptime('User not found: masstarvt'))
  assert.throws(() => normalizeDecapiUptime('Error: rate limited, retry in 30 seconds'))
  assert.throws(() => normalizeDecapiUptime(''))
})
