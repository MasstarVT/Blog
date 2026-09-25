// Client-side Twitch live status, shared by every island (hero badge, stream panel, nav dot).
// A module singleton: it survives ClientRouter navigations and polls only while someone is
// subscribed and the tab is visible. Sources, in order: IVR → shields.io (+ DecAPI details) → DecAPI.
import { useMemo, useSyncExternalStore } from 'react'
import { normalizeIvrUser, normalizeShieldsStatus, normalizeDecapiUptime } from './normalize/ivr.mjs'
import { site } from '../config/site.mjs'

const LOGIN = site.twitch.login
const STORAGE_KEY = 'masstar:live'
const FRESH_MS = 60_000
const TIMEOUT_MS = 8_000
const BACKOFF_MS = [120_000, 180_000, 300_000]

const OFFLINE = {
  isLive: false, title: null, game: null, viewers: null, startedAt: null, thumbnail: null,
  lastBroadcast: { title: null, startedAt: null }, checkedAt: null, source: 'build', error: null,
}

let state = null
let timer = 0
let failures = 0
let inFlight = false
const listeners = new Set()

const emit = () => listeners.forEach((l) => l())

function setState(patch) {
  state = { ...(state ?? OFFLINE), ...patch }
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
  emit()
}

function devParams() {
  if (!import.meta.env.DEV) return {}
  const q = new URLSearchParams(window.location.search)
  return { mock: q.get('mock'), poll: Number(q.get('poll')) || 0 }
}

const pollInterval = () => devParams().poll || site.live.pollMs

// Preview image Twitch regenerates every few minutes; bucket the cache-buster per minute.
const liveThumbnail = () =>
  `https://static-cdn.jtvnw.net/previews-ttv/live_user_${LOGIN}-640x360.jpg?t=${Math.floor(Date.now() / 60_000)}`

async function get(url, as = 'json') {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return as === 'json' ? res.json() : res.text()
}

async function decapiDetails() {
  const base = 'https://decapi.me/twitch'
  const [title, game, viewers] = await Promise.all(
    ['title', 'game', 'viewercount'].map((p) => get(`${base}/${p}/${LOGIN}`, 'text').catch(() => null)),
  )
  const n = Number.parseInt(viewers ?? '', 10)
  return { title: title?.trim() || null, game: game?.trim() || null, viewers: Number.isFinite(n) ? n : null }
}

async function fetchLive() {
  try {
    const { live, lastBroadcast } = normalizeIvrUser(await get(`https://api.ivr.fi/v2/twitch/user?login=${LOGIN}`))
    return { ...live, lastBroadcast: lastBroadcast ?? state?.lastBroadcast, source: 'ivr' }
  } catch {}
  try {
    const { isLive } = normalizeShieldsStatus(await get(`https://img.shields.io/twitch/status/${LOGIN}.json`))
    const details = isLive ? await decapiDetails() : { title: null, game: null, viewers: null }
    return { isLive, ...details, startedAt: isLive ? state?.startedAt ?? null : null, source: 'shields' }
  } catch {}
  const { isLive } = normalizeDecapiUptime(await get(`https://decapi.me/twitch/uptime/${LOGIN}`, 'text'))
  const details = isLive ? await decapiDetails() : { title: null, game: null, viewers: null }
  return { isLive, ...details, startedAt: isLive ? state?.startedAt ?? null : null, source: 'decapi' }
}

function mockState(kind) {
  if (kind === 'live') {
    return {
      isLive: true, title: 'Mock stream — testing the live panel', game: 'Just Chatting', viewers: 42,
      startedAt: new Date(Date.now() - 83 * 60_000).toISOString(), source: 'mock',
    }
  }
  return { isLive: false, title: null, game: null, viewers: null, startedAt: null, source: 'mock' }
}

async function poll() {
  if (inFlight) return
  inFlight = true
  clearTimeout(timer)
  try {
    const { mock } = devParams()
    const next = mock ? mockState(mock) : await fetchLive()
    failures = 0
    setState({ ...next, thumbnail: next.isLive ? liveThumbnail() : null, checkedAt: Date.now(), error: null })
  } catch {
    failures += 1
    setState({ error: 'unavailable', checkedAt: Date.now() })
  } finally {
    inFlight = false
    schedule()
  }
}

function schedule(delay) {
  clearTimeout(timer)
  if (!listeners.size || document.hidden) return
  const wait = delay ?? (failures
    ? BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]
    : pollInterval() + Math.random() * 15_000)
  timer = setTimeout(poll, wait)
}

function onVisibility() {
  if (document.hidden) return clearTimeout(timer)
  const age = Date.now() - (state?.checkedAt ?? 0)
  age > 30_000 ? poll() : schedule(pollInterval() - age)
}

function start() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    if (cached?.checkedAt && Date.now() - cached.checkedAt < FRESH_MS && !devParams().mock) {
      state = cached
      emit()
    }
  } catch {}
  document.addEventListener('visibilitychange', onVisibility)
  const age = Date.now() - (state?.checkedAt ?? 0)
  age < FRESH_MS ? schedule(FRESH_MS - age) : poll()
}

function stop() {
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibility)
}

function subscribe(listener) {
  listeners.add(listener)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) stop()
  }
}

/** Force an immediate re-check (e.g. a "refresh" button). */
export const refreshLive = () => poll()

/**
 * Subscribe to live status. `initial` is the build-time snapshot, used for SSR and the first
 * client render so hydration matches; the store then takes over.
 */
export function useLive(initial) {
  // getServerSnapshot must return a stable object, so memoise the seed
  const fallback = useMemo(() => (initial ? { ...OFFLINE, ...initial } : OFFLINE), [initial])
  if (!state && typeof window !== 'undefined') state = fallback
  return useSyncExternalStore(subscribe, () => state ?? fallback, () => fallback)
}
