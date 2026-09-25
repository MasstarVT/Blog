import { useLive } from '../../lib/live-store.js'

// Pill shown in the hero badges row. Renders the build snapshot on the server and
// flips to the polled state after hydration.
export default function LiveBadge({ live: initial, login = 'masstarvt' }) {
  const live = useLive(initial)
  if (live.isLive) {
    return (
      <a
        className="live-pill is-live"
        href={`https://twitch.tv/${login}`}
        target="_blank"
        rel="noopener noreferrer"
        title={live.title || 'Live on Twitch'}
      >
        <span className="live-dot" aria-hidden="true" />
        Live now{live.viewers != null ? ` · ${live.viewers} watching` : ''}
      </a>
    )
  }
  return (
    <span className="live-pill is-offline">
      <span className="live-dot" aria-hidden="true" />
      Offline
    </span>
  )
}
