// Click-to-load players for VOD / clip / YouTube cards. The card is a normal link to the
// video; with JS on (and enough width for the Twitch player) a click swaps it for an iframe.

function embedUrl(el) {
  const parent = encodeURIComponent(window.location.hostname)
  const id = encodeURIComponent(el.dataset.id)
  switch (el.dataset.embed) {
    case 'twitch-video': return `https://player.twitch.tv/?video=${id}&parent=${parent}&autoplay=true`
    case 'twitch-clip': return `https://clips.twitch.tv/embed?clip=${id}&parent=${parent}&autoplay=true`
    case 'youtube': return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`
    default: return null
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest?.('a[data-embed]')
  if (!el || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const isTwitch = el.dataset.embed.startsWith('twitch')
  // The player takes the whole grid row. Twitch needs a frame of at least 400×300 (16:9 → 534px wide);
  // on narrower rows just follow the link to Twitch.
  const row = el.closest('.video-grid') ?? el.parentElement
  if (isTwitch && row.getBoundingClientRect().width < 534) return
  const src = embedUrl(el)
  if (!src) return
  e.preventDefault()
  const item = el.closest('li')
  if (item) item.style.gridColumn = '1 / -1'
  const frame = document.createElement('div')
  frame.className = 'player-frame'
  const iframe = document.createElement('iframe')
  iframe.src = src
  iframe.title = el.dataset.title || 'Video player'
  iframe.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.append(iframe)
  el.replaceWith(frame)
  iframe.focus()
})
