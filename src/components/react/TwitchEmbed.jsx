import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

// Click-to-load Twitch player (live channel, VOD or clip). Nothing from Twitch loads until
// the visitor asks for it. Twitch refuses to autoplay below 400px wide, so narrow screens
// get a link out instead of an iframe.
export default function TwitchEmbed({ channel, video, clip, poster, title }) {
  const [active, setActive] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const facadeRef = useRef(null)
  const frameRef = useRef(null)

  // Twitch refuses to play in frames under 400px wide: measure the actual slot, not the viewport
  useEffect(() => {
    const el = facadeRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 400))
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])

  useEffect(() => { if (active) frameRef.current?.focus() }, [active])

  const external = clip
    ? `https://clips.twitch.tv/${clip}`
    : video ? `https://www.twitch.tv/videos/${video}` : `https://twitch.tv/${channel}`

  if (active) {
    const parent = encodeURIComponent(window.location.hostname)
    const src = clip
      ? `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip)}&parent=${parent}&autoplay=true`
      : video
        ? `https://player.twitch.tv/?video=${encodeURIComponent(video)}&parent=${parent}&autoplay=true`
        : `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&autoplay=true&muted=false`
    return (
      <div className="player-frame">
        <iframe
          ref={frameRef}
          src={src}
          title={title || 'Twitch player'}
          allow="autoplay; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    )
  }

  const label = clip ? 'Play clip' : video ? 'Play video' : 'Watch the stream here'
  const onClick = (e) => {
    if (narrow) return // follow the link to Twitch on small screens
    e.preventDefault()
    setActive(true)
  }

  return (
    <a ref={facadeRef} className="player-facade" href={external} target="_blank" rel="noopener noreferrer" onClick={onClick}>
      {poster && <img src={poster} alt="" loading="lazy" decoding="async" />}
      <span className="player-facade-play" aria-hidden="true"><Icon name="play" size={34} /></span>
      <span className="player-facade-label">{narrow ? 'Watch on Twitch ↗' : label}</span>
      <span className="player-facade-note">Loads the Twitch player (sets Twitch cookies)</span>
    </a>
  )
}
