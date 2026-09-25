import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttp } from '../lib/http.mjs'
import { runPart } from '../lib/run-source.mjs'
import { buildTwitch } from '../lib/sources/twitch.mjs'
import { fetchDiscord } from '../lib/sources/discord.mjs'
import { fetchBluesky } from '../lib/sources/bluesky.mjs'
import { fetchYouTube, youtubeDefaults } from '../lib/sources/youtube.mjs'
import { fetchX, readCurated } from '../lib/sources/x.mjs'
import { site as realSite } from '../../src/config/site.mjs'
import { defaults } from '../../src/data/defaults.mjs'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const NOW = new Date('2026-10-25T12:00:00Z')
const CREDS = { TWITCH_CLIENT_ID: 'cid123', TWITCH_CLIENT_SECRET: 'csecret456' }

/**
 * Fake fetch: routes are [matcher, reply] where matcher is a URL prefix or RegExp and reply is
 * { status, body } | Error | (url, init) => reply. Records every call.
 */
function fakeFetch(routes) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body })
    for (const [match, reply] of routes) {
      if (typeof match === 'string' ? !url.startsWith(match) : !match.test(url)) continue
      const r = typeof reply === 'function' ? await reply(url, init) : reply
      if (r instanceof Error) throw r
      const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null)
      return new Response(body, { status: r.status ?? 200 })
    }
    return new Response('no route', { status: 418 })
  }
  return { fetch, calls, http: createHttp({ fetch, backoffMs: 1 }) }
}

const ok = (name) => ({ status: 200, body: name.endsWith('.json') ? JSON.parse(fixture(name)) : fixture(name) })
const status = (code) => ({ status: code, body: '' })

const IVR = 'https://api.ivr.fi/v2/twitch/user?login=masstarvt'
const ICAL = 'https://api.twitch.tv/helix/schedule/icalendar?broadcaster_id=139905616'
const SHIELDS = 'https://img.shields.io/twitch/status/masstarvt.json'

/** Every key of the defaults exists in `actual` with a compatible type. */
function assertShape(actual, expected, path = '') {
  for (const [k, v] of Object.entries(expected)) {
    assert.ok(actual && k in actual, `${path}${k} missing`)
    if (Array.isArray(v)) assert.ok(Array.isArray(actual[k]), `${path}${k} should be an array`)
    else if (v && typeof v === 'object' && Object.keys(v).length) assertShape(actual[k], v, `${path}${k}.`)
    else if (typeof v === 'boolean') assert.equal(typeof actual[k], 'boolean', `${path}${k} should be boolean`)
  }
}

function twitchCtx(fake, extra = {}) {
  const reports = []
  return {
    reports,
    ctx: { http: fake.http, env: {}, site: realSite, now: NOW, prev: null, def: defaults.twitch, report: (r) => reports.push(r), ...extra },
  }
}

test('twitch without credentials: IVR + iCal, videos/clips skipped', async () => {
  const fake = fakeFetch([[IVR, ok('ivr-user-offline.json')], [ICAL, ok('twitch-ical-dst.ics')]])
  const { ctx } = twitchCtx(fake)
  const out = await buildTwitch(ctx)
  assertShape(out, defaults.twitch)
  assert.deepEqual(out.status, { user: 'ok', live: 'ok', schedule: 'ok', videos: 'skipped:no-credentials', clips: 'skipped:no-credentials' })
  assert.equal(out.fetchedAt, NOW.toISOString())
  assert.equal(out.user.followers, 116)
  assert.deepEqual(out.live, defaults.twitch.live)
  assert.equal(out.lastBroadcast.title, 'Swimming in a new sea with @Urgirlfriendpai')
  assert.equal(out.schedule.source, 'ical')
  assert.equal(out.schedule.segments.length, 9)
  assert.deepEqual([out.videos, out.clips, out.staleSince], [[], [], {}])
  assert.equal(fake.calls.filter((c) => c.url === IVR).length, 1, 'IVR fetched once for user + live')
  assert.ok(!fake.calls.some((c) => c.url.includes('id.twitch.tv') || c.url.includes('/helix/videos')))
})

test('twitch with credentials: token in body, Helix schedule/videos/clips, token revoked', async () => {
  const fake = fakeFetch([
    ['https://id.twitch.tv/oauth2/token', { body: { access_token: 'tok789', expires_in: 5000000, token_type: 'bearer' } }],
    ['https://id.twitch.tv/oauth2/revoke', { body: '' }],
    [IVR, ok('ivr-user-live.json')],
    ['https://api.twitch.tv/helix/schedule?', ok('helix-schedule.json')],
    ['https://api.twitch.tv/helix/videos?', ok('helix-videos.json')],
    [/\/helix\/clips\?.*started_at=/, ok('helix-clips-recent.json')],
    ['https://api.twitch.tv/helix/clips?', ok('helix-clips-alltime.json')],
  ])
  const { ctx } = twitchCtx(fake, { env: CREDS })
  const out = await buildTwitch(ctx)
  assertShape(out, defaults.twitch)
  assert.deepEqual(out.status, { user: 'ok', live: 'ok', schedule: 'ok', videos: 'ok', clips: 'ok' })
  assert.equal(out.live.isLive, true)
  assert.equal(out.live.viewers, 37)
  assert.equal(out.schedule.source, 'helix')
  assert.equal(out.schedule.segments.length, 2)
  assert.ok(out.schedule.vacation)
  assert.equal(out.videos.length, 3)
  assert.deepEqual(out.clips.map((c) => c.id), ['NewerClip-def', 'PopularButOlderClip-abc', 'AllTimeSecond-222', 'AllTimeTop-111'])

  const token = fake.calls.find((c) => c.url.startsWith('https://id.twitch.tv/oauth2/token'))
  assert.equal(token.method, 'POST')
  assert.equal(token.url, 'https://id.twitch.tv/oauth2/token', 'no secrets in the URL')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), { client_id: 'cid123', client_secret: 'csecret456', grant_type: 'client_credentials' })
  assert.equal(token.headers.get('content-type'), 'application/x-www-form-urlencoded')
  assert.equal(fake.calls.filter((c) => c.url.startsWith('https://id.twitch.tv/oauth2/token')).length, 1, 'one token for all parts')

  for (const c of fake.calls.filter((c) => c.url.startsWith('https://api.twitch.tv/helix/') && !c.url.includes('icalendar'))) {
    assert.equal(c.headers.get('client-id'), 'cid123')
    assert.equal(c.headers.get('authorization'), 'Bearer tok789')
  }
  const recent = new URL(fake.calls.find((c) => c.url.includes('started_at=')).url)
  assert.equal(recent.searchParams.get('ended_at'), NOW.toISOString())
  assert.equal(recent.searchParams.get('started_at'), new Date(NOW.getTime() - 90 * 86_400_000).toISOString())
  const videos = new URL(fake.calls.find((c) => c.url.includes('/helix/videos')).url)
  assert.deepEqual(Object.fromEntries(videos.searchParams), { user_id: '139905616', type: 'all', sort: 'time', first: '12' })

  const revoke = fake.calls.at(-1)
  assert.equal(revoke.url, 'https://id.twitch.tv/oauth2/revoke')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(revoke.body)), { client_id: 'cid123', token: 'tok789' })
})

test('twitch: Helix schedule 404 means an empty schedule, not an error', async () => {
  const fake = fakeFetch([
    ['https://id.twitch.tv/oauth2/token', { body: { access_token: 't' } }],
    ['https://id.twitch.tv/oauth2/revoke', { body: '' }],
    [IVR, ok('ivr-user-offline.json')],
    ['https://api.twitch.tv/helix/schedule?', { status: 404, body: JSON.parse(fixture('helix-404.json')) }],
    ['https://api.twitch.tv/helix/videos?', { body: { data: [] } }],
    ['https://api.twitch.tv/helix/clips?', { body: { data: [] } }],
  ])
  const out = await buildTwitch(twitchCtx(fake, { env: CREDS }).ctx)
  assert.equal(out.status.schedule, 'ok')
  assert.deepEqual(out.schedule, { source: 'helix', vacation: null, segments: [] })
  assert.deepEqual([out.status.videos, out.videos, out.status.clips, out.clips], ['ok', [], 'ok', []])
  assert.ok(!fake.calls.some((c) => c.url.startsWith(ICAL)))
})

test('twitch: Helix schedule failure falls back to iCal; token failure → video parts empty', async () => {
  const fake = fakeFetch([
    ['https://id.twitch.tv/oauth2/token', status(400)],
    [IVR, ok('ivr-user-offline.json')],
    [ICAL, ok('twitch-ical-empty.ics')],
  ])
  const { ctx, reports } = twitchCtx(fake, { env: CREDS })
  const out = await buildTwitch(ctx)
  assert.deepEqual(out.status, { user: 'ok', live: 'ok', schedule: 'ok', videos: 'empty', clips: 'empty' })
  assert.deepEqual(out.schedule, { source: 'ical', vacation: null, segments: [] })
  assert.match(reports.find((r) => r.name === 'twitch.videos').error, /HTTP 400 https:\/\/id\.twitch\.tv\/oauth2\/token/)
  assert.ok(!fake.calls.some((c) => c.url.includes('revoke')), 'nothing to revoke')
})

const PREV_TWITCH = {
  ...defaults.twitch,
  fetchedAt: '2026-10-24T12:00:00.000Z',
  status: { user: 'ok', live: 'ok', schedule: 'ok', videos: 'ok', clips: 'stale' },
  staleSince: { clips: '2026-10-20T00:00:00.000Z' },
  user: { ...defaults.twitch.user, followers: 100, bio: 'old bio' },
  live: { isLive: true, title: 'old live', game: 'x', viewers: 5, startedAt: '2026-10-24T11:00:00.000Z', thumbnail: 'https://t' },
  lastBroadcast: { title: 'previous broadcast', startedAt: '2026-10-24T11:00:00.000Z' },
  schedule: { source: 'ical', vacation: null, segments: [] },
  videos: [{ id: 'v1' }],
  clips: [{ id: 'c1' }],
}

test('twitch: IVR down → user stale, live from shields.io', async () => {
  const fake = fakeFetch([[IVR, status(503)], [SHIELDS, ok('shields-status-offline.json')], [ICAL, ok('twitch-ical-empty.ics')]])
  const out = await buildTwitch(twitchCtx(fake, { prev: PREV_TWITCH }).ctx)
  assert.equal(out.status.user, 'stale')
  assert.equal(out.staleSince.user, '2026-10-24T12:00:00.000Z')
  assert.equal(out.user.bio, 'old bio')
  assert.equal(out.status.live, 'ok')
  assert.deepEqual(out.live, defaults.twitch.live)
  assert.deepEqual(out.lastBroadcast, PREV_TWITCH.lastBroadcast)
  // no credentials: earlier VODs/clips are kept
  assert.deepEqual([out.status.videos, out.videos], ['skipped:no-credentials', [{ id: 'v1' }]])
  assert.deepEqual([out.status.clips, out.clips], ['skipped:no-credentials', [{ id: 'c1' }]])
  assert.equal(out.staleSince.clips, undefined)
})

test('twitch: shields.io live → DecAPI details', async () => {
  const fake = fakeFetch([
    [IVR, status(500)],
    [SHIELDS, { body: { message: 'live' } }],
    ['https://decapi.me/twitch/title/', { body: 'Title from DecAPI\n' }],
    ['https://decapi.me/twitch/game/', { body: 'Art' }],
    ['https://decapi.me/twitch/viewercount/', { body: '42' }],
    [ICAL, ok('twitch-ical-empty.ics')],
  ])
  const out = await buildTwitch(twitchCtx(fake).ctx)
  assert.equal(out.status.user, 'empty')
  assert.equal(out.status.live, 'ok')
  assert.deepEqual(out.live, { isLive: true, title: 'Title from DecAPI', game: 'Art', viewers: 42, startedAt: null, thumbnail: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_masstarvt-640x360.jpg' })
})

test('twitch: everything down → stale parts, but never a stale LIVE flag', async () => {
  const fake = fakeFetch([[/./, new TypeError('fetch failed')]])
  const out = await buildTwitch(twitchCtx(fake, { prev: PREV_TWITCH }).ctx)
  assert.deepEqual(out.status, { user: 'stale', live: 'stale', schedule: 'stale', videos: 'skipped:no-credentials', clips: 'skipped:no-credentials' })
  assert.deepEqual(out.live, defaults.twitch.live)
  assert.deepEqual(out.lastBroadcast, PREV_TWITCH.lastBroadcast)
  assert.deepEqual(out.staleSince, { user: '2026-10-24T12:00:00.000Z', live: '2026-10-24T12:00:00.000Z', schedule: '2026-10-24T12:00:00.000Z' })

  const fresh = await buildTwitch(twitchCtx(fakeFetch([[/./, new TypeError('fetch failed')]])).ctx)
  assert.deepEqual(fresh.status, { user: 'empty', live: 'empty', schedule: 'empty', videos: 'skipped:no-credentials', clips: 'skipped:no-credentials' })
  assert.equal(fresh.fetchedAt, null, 'nothing was fetched')
  assertShape(fresh, defaults.twitch)
})

test('twitch: fetchedAt is the oldest real fetch, so stale parts never look freshly checked', async () => {
  const down = () => fakeFetch([[/./, new TypeError('fetch failed')]])
  const first = await buildTwitch(twitchCtx(down(), { prev: PREV_TWITCH }).ctx)
  assert.equal(first.fetchedAt, PREV_TWITCH.fetchedAt)
  assert.deepEqual(first.partFetchedAt, {
    user: PREV_TWITCH.fetchedAt, live: PREV_TWITCH.fetchedAt, schedule: PREV_TWITCH.fetchedAt,
    videos: PREV_TWITCH.fetchedAt, clips: '2026-10-20T00:00:00.000Z', // kept (skipped) with their real fetch time
  })

  // a second failing run an hour later changes nothing about the timestamps
  const second = await buildTwitch(twitchCtx(down(), { prev: first, now: new Date(NOW.getTime() + 3_600_000) }).ctx)
  assert.equal(second.fetchedAt, PREV_TWITCH.fetchedAt)
  assert.deepEqual(second.staleSince, first.staleSince)
  assert.deepEqual(second.partFetchedAt, first.partFetchedAt)

  // IVR back, iCal still unreachable: user/live are fresh, the schedule keeps its old time
  const partial = await buildTwitch(twitchCtx(fakeFetch([[IVR, ok('ivr-user-offline.json')], [ICAL, new TypeError('fetch failed')]]), { prev: second }).ctx)
  assert.deepEqual([partial.status.user, partial.status.live, partial.status.schedule], ['ok', 'ok', 'stale'])
  assert.equal(partial.partFetchedAt.user, NOW.toISOString())
  assert.equal(partial.partFetchedAt.schedule, PREV_TWITCH.fetchedAt)
  assert.equal(partial.staleSince.schedule, PREV_TWITCH.fetchedAt)
  assert.equal(partial.fetchedAt, PREV_TWITCH.fetchedAt)
})

test('twitch: parts that were only ever skipped have nothing to go stale on', async () => {
  const routes = () => fakeFetch([
    ['https://id.twitch.tv/oauth2/token', { body: { access_token: 't' } }],
    ['https://id.twitch.tv/oauth2/revoke', { body: '' }],
    [IVR, ok('ivr-user-offline.json')],
    [/\/helix\/(schedule|videos|clips)\?/, status(503)],
    [ICAL, ok('twitch-ical-empty.ics')],
  ])
  const prev = {
    ...defaults.twitch,
    fetchedAt: '2026-10-20T00:00:00.000Z',
    status: { user: 'ok', live: 'ok', schedule: 'ok', videos: 'skipped:no-credentials', clips: 'skipped:no-credentials' },
    staleSince: {},
  }
  // credentials were just added and Helix fails: never fetched → empty, not stale
  const out = await buildTwitch(twitchCtx(routes(), { env: CREDS, prev }).ctx)
  assert.deepEqual([out.status.videos, out.status.clips], ['empty', 'empty'])
  assert.deepEqual(out.staleSince, {})
  assert.deepEqual([out.partFetchedAt.videos, out.partFetchedAt.clips], [null, null])
  assert.equal(out.status.schedule, 'ok', 'Helix schedule down → iCal')

  // a skipped part that still holds data from an earlier real fetch does go stale
  const kept = {
    ...prev,
    videos: [{ id: 'v1' }],
    partFetchedAt: { user: prev.fetchedAt, live: prev.fetchedAt, schedule: prev.fetchedAt, videos: '2026-10-10T00:00:00.000Z', clips: null },
  }
  const again = await buildTwitch(twitchCtx(routes(), { env: CREDS, prev: kept }).ctx)
  assert.deepEqual([again.status.videos, again.videos, again.staleSince.videos], ['stale', [{ id: 'v1' }], '2026-10-10T00:00:00.000Z'])
  assert.equal(again.partFetchedAt.videos, '2026-10-10T00:00:00.000Z')
  assert.equal(again.status.clips, 'empty')
})

const segment = (start, end) => ({ id: `u@${start}`, title: 'Stream', category: null, start, end, recurring: false, canceled: false })

test('twitch: iCal 5xx reads as an empty calendar unless the last data still had upcoming streams', async () => {
  const routes = () => fakeFetch([[IVR, ok('ivr-user-offline.json')], [ICAL, status(500)]])
  const empty = { source: 'ical', vacation: null, segments: [] }

  const fresh = await buildTwitch(twitchCtx(routes()).ctx)
  assert.deepEqual([fresh.status.schedule, fresh.schedule], ['ok', empty])

  const ended = { ...PREV_TWITCH, schedule: { ...empty, segments: [segment('2026-10-20T19:00:00.000Z', '2026-10-20T21:00:00.000Z')] } }
  const afterEnded = await buildTwitch(twitchCtx(routes(), { prev: ended }).ctx)
  assert.deepEqual([afterEnded.status.schedule, afterEnded.schedule], ['ok', empty])

  const upcoming = { ...PREV_TWITCH, schedule: { ...empty, segments: [segment('2026-10-26T19:00:00.000Z', '2026-10-26T21:00:00.000Z')] } }
  const { ctx, reports } = twitchCtx(routes(), { prev: upcoming })
  const outage = await buildTwitch(ctx)
  assert.deepEqual([outage.status.schedule, outage.schedule.segments.length, outage.staleSince.schedule], ['stale', 1, PREV_TWITCH.fetchedAt])
  assert.match(reports.find((r) => r.name === 'twitch.schedule').error, /HTTP 500/)

  // Helix failed too (credentials set): two failing endpoints are an outage, not an empty calendar
  const both = fakeFetch([
    ['https://id.twitch.tv/oauth2/token', { body: { access_token: 't' } }],
    ['https://id.twitch.tv/oauth2/revoke', { body: '' }],
    [IVR, ok('ivr-user-offline.json')],
    [/\/helix\/(schedule|videos|clips)\?/, status(503)],
    [ICAL, status(500)],
  ])
  assert.equal((await buildTwitch(twitchCtx(both, { env: CREDS }).ctx)).status.schedule, 'empty')
})

test('twitch: a 200 response that is not a calendar never replaces the schedule', async () => {
  const html = '<!doctype html><html><body><p>Twitch is having trouble</p></body></html>'
  const upcoming = { ...PREV_TWITCH, schedule: { source: 'ical', vacation: null, segments: [segment('2026-10-26T19:00:00.000Z', '2026-10-26T21:00:00.000Z')] } }
  const { ctx, reports } = twitchCtx(fakeFetch([[IVR, status(500)], [SHIELDS, ok('shields-status-offline.json')], [ICAL, { body: html }]]), { prev: upcoming })
  const out = await buildTwitch(ctx)
  assert.deepEqual([out.status.schedule, out.schedule.segments.length], ['stale', 1])
  assert.match(reports.find((r) => r.name === 'twitch.schedule').error, /not a calendar/)

  const fresh = await buildTwitch(twitchCtx(fakeFetch([[IVR, ok('ivr-user-offline.json')], [ICAL, { body: '{"error":"x"}' }]])).ctx)
  assert.equal(fresh.status.schedule, 'empty')
  // a BOM or lowercase property names are still a calendar
  const bom = await buildTwitch(twitchCtx(fakeFetch([[IVR, ok('ivr-user-offline.json')], [ICAL, { body: `﻿${fixture('twitch-ical-empty.ics')}` }]])).ctx)
  assert.equal(bom.status.schedule, 'ok')
})

test('twitch: the app token request is never retried (a lost response would leak an unrevoked token)', async () => {
  const issued = []
  const revoked = []
  const fake = fakeFetch([
    ['https://id.twitch.tv/oauth2/token', () => {
      issued.push(`tok${issued.length + 1}`)
      return issued.length === 1 ? new TypeError('fetch failed') : { body: { access_token: issued.at(-1) } }
    }],
    ['https://id.twitch.tv/oauth2/revoke', (url, init) => {
      revoked.push(new URLSearchParams(init.body).get('token'))
      return { body: '' }
    }],
    [IVR, ok('ivr-user-offline.json')],
    [ICAL, ok('twitch-ical-empty.ics')],
  ])
  const out = await buildTwitch(twitchCtx(fake, { env: CREDS }).ctx)
  assert.deepEqual(issued, ['tok1'], 'one token request only')
  assert.deepEqual(revoked, [])
  assert.deepEqual(out.status, { user: 'ok', live: 'ok', schedule: 'ok', videos: 'empty', clips: 'empty' })
  assert.equal(out.schedule.source, 'ical')
})

test('discord source', async () => {
  const fake = fakeFetch([['https://discord.com/api/v10/invites/EgSGhrVqQw?with_counts=true', ok('discord-invite.json')]])
  const out = await runPart('discord', () => fetchDiscord({ http: fake.http, site: realSite }), null, defaults.discord, { now: NOW })
  assertShape(out, defaults.discord)
  assert.equal(out.status, 'ok')
  assert.equal(out.members, 48)
  assert.equal(out.name, "Mass's Hideout")
  const skipped = await runPart('discord', () => fetchDiscord({ http: fake.http, site: { ...realSite, discord: null } }), null, defaults.discord)
  assert.equal(skipped.status, 'skipped:not-configured')
})

test('bluesky source: feed + profile, profile fallback, feed failure', async () => {
  const FEED = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?'
  const PROFILE = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?'
  const fake = fakeFetch([[FEED, ok('bluesky-feed.json')], [PROFILE, ok('bluesky-profile.json')]])
  const out = await runPart('bluesky', () => fetchBluesky({ http: fake.http, site: realSite }), null, defaults.bluesky, { now: NOW })
  assertShape(out, defaults.bluesky)
  assert.equal(out.status, 'ok')
  assert.equal(out.posts.length, 5, 'maxPosts')
  assert.match(out.profile.displayName, /^Mass/)
  const feedUrl = new URL(fake.calls.find((c) => c.url.startsWith(FEED)).url)
  assert.deepEqual(Object.fromEntries(feedUrl.searchParams), { actor: 'mass.masstar.org', limit: '15', filter: 'posts_no_replies' })

  const noProfile = fakeFetch([[FEED, ok('bluesky-feed.json')], [PROFILE, status(502)]])
  const fallback = await fetchBluesky({ http: noProfile.http, site: realSite })
  assert.equal(fallback.profile.displayName, out.profile.displayName)
  assert.equal(fallback.profile.avatar, out.profile.avatar)

  const down = fakeFetch([[FEED, status(500)], [PROFILE, ok('bluesky-profile.json')]])
  await assert.rejects(fetchBluesky({ http: down.http, site: realSite }), /HTTP 500/)
})

test('youtube source: skipped until configured, RSS, API fallback', async () => {
  const skipped = await runPart('youtube', () => fetchYouTube({ http: createHttp(), site: realSite, env: {} }), null, defaults.youtube)
  assert.deepEqual(skipped, { ...defaults.youtube, status: 'skipped:not-configured' })

  const site = { ...realSite, youtube: { channelId: 'UCtestchannel0000000000', handle: null } }
  const RSS = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCtestchannel0000000000'
  const rss = fakeFetch([[RSS, ok('youtube-feed.xml')]])
  const out = await runPart('youtube', () => fetchYouTube({ http: rss.http, site, env: {} }), null, defaults.youtube, { now: NOW })
  assertShape(out, defaults.youtube)
  assert.deepEqual([out.status, out.configured, out.channelUrl, out.videos.length], ['ok', true, 'https://www.youtube.com/channel/UCtestchannel0000000000', 3])

  const api = fakeFetch([[RSS, status(500)], ['https://www.googleapis.com/youtube/v3/playlistItems?', ok('youtube-playlist-items.json')]])
  const viaApi = await fetchYouTube({ http: api.http, site, env: { YOUTUBE_API_KEY: 'AIzaSECRET' } })
  assert.equal(viaApi.videos.length, 1)
  const apiUrl = new URL(api.calls.at(-1).url)
  assert.equal(apiUrl.searchParams.get('playlistId'), 'UUtestchannel0000000000')

  const broken = fakeFetch([[RSS, status(500)], ['https://www.googleapis.com/', status(403)]])
  await assert.rejects(fetchYouTube({ http: broken.http, site, env: { YOUTUBE_API_KEY: 'AIzaSECRET' } }), (err) => {
    assert.match(err.message, /HTTP 403/)
    assert.ok(!err.message.includes('AIzaSECRET'), 'API key is redacted')
    return true
  })
  await assert.rejects(fetchYouTube({ http: broken.http, site, env: {} }), /HTTP 500/)

  // configured but the first fetch fails: still configured, with its channel URL
  const def = youtubeDefaults(site, defaults.youtube)
  const failed = await runPart('youtube', () => fetchYouTube({ http: broken.http, site, env: {} }), null, def, { now: NOW })
  assert.deepEqual(failed, { ...defaults.youtube, configured: true, channelUrl: 'https://www.youtube.com/channel/UCtestchannel0000000000', status: 'empty' })
  assert.equal(youtubeDefaults(realSite, defaults.youtube), defaults.youtube, 'unconfigured: the plain defaults')
})

async function withCurated(posts, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'xposts-'))
  const file = join(dir, 'x-posts.json')
  await writeFile(file, JSON.stringify({ posts }))
  try {
    return await fn(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('x: nothing configured → skipped (source none)', async () => {
  await withCurated([], async (curatedFile) => {
    const out = await runPart('x', () => fetchX({ http: createHttp({ offline: true }), site: realSite, env: {}, curatedFile }), null, defaults.x)
    assert.deepEqual(out, { ...defaults.x, status: 'skipped:not-configured' })
  })
})

test('x: curated posts via oEmbed — deleted dropped, failures kept as bare links', async () => {
  const urls = [
    'https://twitter.com/Interior/status/463440424141459456?ref_src=twsrc',
    'https://x.com/MasstarVT/status/111',
    'https://x.com/MasstarVT/status/222',
    'https://x.com/MasstarVT/status/333',
    'https://x.com/MasstarVT/status/444',
    'https://example.com/not-x',
    'https://x.com/Interior/status/463440424141459456',
  ]
  await withCurated(urls, async (curatedFile) => {
    assert.deepEqual((await readCurated(curatedFile)).map((r) => r.id), ['463440424141459456', '111', '222', '333', '444'])
    const fake = fakeFetch([
      [/oembed\?url=https%3A%2F%2Fx\.com%2FInterior%2Fstatus%2F463440424141459456&omit_script=true&dnt=true$/, ok('x-oembed.json')],
      [/status%2F111&/, status(404)],
      [/status%2F222&/, status(500)],
      [/status%2F333&/, status(503)],
      [/status%2F444&/, status(403)],
    ])
    // Earlier oEmbed text must never be republished once the post stops being public.
    const cached = (id) => ({ id, url: `https://x.com/MasstarVT/status/${id}`, createdAt: '2026-01-01', text: `cached ${id}`, authorName: 'Mass', authorHandle: 'MasstarVT', richness: 'oembed' })
    const prev = { ...defaults.x, fetchedAt: '2026-10-01T00:00:00.000Z', status: 'ok', source: 'curated', featured: [cached('333'), cached('444')] }
    const out = await runPart('x', () => fetchX({ http: fake.http, site: realSite, env: {}, prev, curatedFile }), prev, defaults.x, { now: NOW })
    assertShape(out, defaults.x)
    assert.equal(out.status, 'ok')
    assert.equal(out.source, 'curated')
    assert.deepEqual(out.posts, [])
    assert.deepEqual(out.featured.map((p) => [p.id, p.richness]), [['463440424141459456', 'oembed'], ['222', 'link'], ['333', 'link'], ['444', 'link']])
    assert.equal(out.featured[0].text.includes('<'), false)
    assert.deepEqual(out.featured[1], { id: '222', url: 'https://x.com/MasstarVT/status/222', createdAt: null, text: null, authorName: null, authorHandle: 'MasstarVT', richness: 'link' })
    for (const p of out.featured.slice(1)) assert.deepEqual([p.text, p.authorName, p.createdAt], [null, null, null])
    assert.ok(!JSON.stringify(out).includes('cached'))
    assert.ok(fake.calls.every((c) => c.url.startsWith('https://publish.x.com/oembed?')))
    assert.ok(!fake.calls.some((c) => /syndication|timeline-profile/.test(c.url)))
  })
})

test('x: handle-less curated URLs are checked as /i/status/<id> (oEmbed 404s /i/web/status/)', async () => {
  await withCurated(['https://x.com/i/web/status/20', 'https://twitter.com/i/status/21?s=20'], async (curatedFile) => {
    const fake = fakeFetch([
      [/oembed\?url=https%3A%2F%2Fx\.com%2Fi%2Fstatus%2F(20|21)&/, ok('x-oembed.json')],
      [/i%2Fweb%2Fstatus/, status(404)],
    ])
    const out = await fetchX({ http: fake.http, site: realSite, env: {}, curatedFile })
    assert.deepEqual(fake.calls.map((c) => new URL(c.url).searchParams.get('url')), ['https://x.com/i/status/20', 'https://x.com/i/status/21'])
    assert.deepEqual(out.featured.map((p) => [p.id, p.richness, p.url]), [
      ['20', 'oembed', 'https://x.com/Interior/status/20'],
      ['21', 'oembed', 'https://x.com/Interior/status/21'],
    ])
  })
})

test('x: a failing X API falls back to the curated posts instead of discarding them', async () => {
  const env = { X_API_KEY: 'ck', X_API_SECRET: 'cs', X_ACCESS_TOKEN: 'at', X_ACCESS_SECRET: 'as' }
  const site = { ...realSite, x: { ...realSite.x, userId: '42' } }
  await withCurated(['https://x.com/Interior/status/463440424141459456'], async (curatedFile) => {
    const fake = fakeFetch([['https://publish.x.com/oembed?', ok('x-oembed.json')], ['https://api.x.com/', status(403)]])
    const reports = []
    const report = (r) => reports.push(r)
    const out = await runPart('x', () => fetchX({ http: fake.http, site, env, curatedFile, report }), null, defaults.x, { now: NOW, report })
    assert.deepEqual([out.status, out.source, out.posts, out.featured.length], ['ok', 'curated', [], 1])
    assert.match(reports.find((r) => r.error).error, /^X API failed, using curated posts: HTTP 403 https:\/\/api\.x\.com\//)
  })
  // nothing curated to fall back to → the error propagates (runPart then marks x stale/empty)
  await withCurated([], async (curatedFile) => {
    const fake = fakeFetch([['https://api.x.com/', status(403)]])
    const out = await runPart('x', () => fetchX({ http: fake.http, site, env, curatedFile }), null, defaults.x, { now: NOW })
    assert.deepEqual([out.status, out.source, out.featured], ['empty', 'none', []])
  })
})

test('x: API provider signs requests (OAuth 1.0a) and looks up the user id', async () => {
  const env = { X_API_KEY: 'ck', X_API_SECRET: 'cs', X_ACCESS_TOKEN: 'at', X_ACCESS_SECRET: 'as' }
  await withCurated([], async (curatedFile) => {
    const fake = fakeFetch([
      ['https://api.x.com/2/users/by/username/MasstarVT', ok('x-api-user.json')],
      ['https://api.x.com/2/users/1234567890/tweets?', ok('x-api-tweets.json')],
    ])
    const out = await runPart('x', () => fetchX({ http: fake.http, site: realSite, env, curatedFile }), null, defaults.x, { now: NOW })
    assert.equal(out.status, 'ok')
    assert.equal(out.source, 'api')
    assert.equal(out.posts.length, 2)
    assert.equal(out.posts[0].authorName, 'MasstarVT')
    assert.equal(fake.calls[1].url, 'https://api.x.com/2/users/1234567890/tweets?max_results=5&exclude=replies%2Cretweets&tweet.fields=created_at')
    for (const c of fake.calls) {
      const auth = c.headers.get('authorization')
      assert.match(auth, /^OAuth /)
      assert.match(auth, /oauth_consumer_key="ck"/)
      assert.match(auth, /oauth_token="at"/)
      assert.match(auth, /oauth_signature="[^"]+"/)
      assert.ok(!auth.includes('"cs"') && !auth.includes('"as"'), 'secrets never leave the process')
    }

    const known = fakeFetch([['https://api.x.com/2/users/42/tweets?', ok('x-api-tweets.json')]])
    const site = { ...realSite, x: { ...realSite.x, userId: '42' } }
    const direct = await fetchX({ http: known.http, site, env, curatedFile })
    assert.equal(known.calls.length, 1, 'no user lookup when userId is configured')
    assert.equal(direct.posts[0].authorName, null)

    const failing = fakeFetch([[/./, status(429)]])
    await assert.rejects(fetchX({ http: failing.http, site, env, curatedFile }), /HTTP 429/)
    assert.equal(failing.calls.length, 1, 'signed requests are not retried')
  })
})
