import { useEffect, useRef, useState } from 'react'
import { useLive } from '../../lib/live-store.js'
import { relativeTime, uptime, formatDate } from '../../lib/format.mjs'
import TwitchEmbed from './TwitchEmbed.jsx'

// Hub "Stream" panel status: live card (with click-to-load player) or offline card.
// Relative times render only after mount; the server HTML carries absolute dates.
export default function LiveStatus({ live: initial, login, offlineImage, scheduleLink = true }) {
  const live = useLive(initial)
  const [now, setNow] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const wasLive = useRef(live.isLive)

  // Screen readers hear only the live/offline flip, not every viewer-count or uptime tick
  useEffect(() => {
    if (wasLive.current === live.isLive) return
    wasLive.current = live.isLive
    setAnnouncement(live.isLive ? `${login} is now live${live.title ? `: ${live.title}` : ''}` : 'The stream has ended')
  }, [live.isLive, live.title, login])

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const last = live.lastBroadcast

  return (
    <div className="live-status">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {live.isLive ? (
        <div className="live-card">
          <TwitchEmbed channel={login} poster={live.thumbnail} title={live.title} />
          <div className="live-card-meta">
            <span className="live-pill is-live"><span className="live-dot" aria-hidden="true" />Live</span>
            <h3 className="live-card-title">{live.title || `${login} is live`}</h3>
            <p className="live-card-sub">
              {[
                live.game,
                live.viewers != null ? `${live.viewers} watching` : null,
                live.startedAt && now ? `up ${uptime(live.startedAt, now)}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            <a className="cta-button primary" href={`https://twitch.tv/${login}`} target="_blank" rel="noopener noreferrer">
              Watch on Twitch
            </a>
          </div>
        </div>
      ) : (
        <div className="offline-card">
          {offlineImage && <img className="offline-card-banner" src={offlineImage} alt="" loading="lazy" decoding="async" />}
          <div className="offline-card-body">
            <span className="live-pill is-offline"><span className="live-dot" aria-hidden="true" />Offline</span>
            <h3 className="live-card-title">Not live right now</h3>
            {last?.startedAt ? (
              <p className="live-card-sub">
                Last stream{' '}
                <time dateTime={last.startedAt}>
                  {now ? relativeTime(last.startedAt, now) : `on ${formatDate(last.startedAt)}`}
                </time>
                {last.title ? <>: <span className="offline-last-title">{last.title}</span></> : null}
              </p>
            ) : (
              <p className="live-card-sub">Follow on Twitch to get notified when the stream starts.</p>
            )}
            <div className="offline-card-actions">
              <a className="cta-button primary" href={`https://twitch.tv/${login}`} target="_blank" rel="noopener noreferrer">Follow on Twitch</a>
              {scheduleLink && <a className="cta-button ghost" href="/schedule/">See the schedule</a>}
            </div>
          </div>
        </div>
      )}
      {live.error && live.checkedAt && (
        <p className="stale-note">Couldn't reach Twitch just now — showing the last known status.</p>
      )}
    </div>
  )
}
