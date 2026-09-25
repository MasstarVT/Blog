// Upgrades the themed X cards to official embeds and tries the profile timeline — only once the
// X section scrolls near the viewport. Anything that fails leaves the readable fallback in place.
const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js'
const TIMELINE_TIMEOUT_MS = 6000
let widgetsPromise

function loadWidgets() {
  if (window.twttr?.widgets) return Promise.resolve(window.twttr)
  widgetsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = WIDGETS_SRC
    s.async = true
    s.charset = 'utf-8'
    s.onload = () => (window.twttr?.ready ? window.twttr.ready(resolve) : resolve(window.twttr))
    s.onerror = () => { widgetsPromise = undefined; reject(new Error('widgets.js blocked')) }
    document.body.append(s)
  })
  return widgetsPromise
}

function fallback(feed, slot) {
  slot?.remove()
  if (!feed.querySelector('[data-x-cards]')) feed.querySelector('[data-x-follow]')?.removeAttribute('hidden')
}

async function upgrade(feed) {
  const slot = feed.querySelector('[data-x-timeline]')
  const cards = feed.querySelector('[data-x-cards]')
  if (slot) slot.dataset.state = 'loading'
  let twttr
  try {
    twttr = await loadWidgets()
  } catch {
    return fallback(feed, slot)
  }
  if (cards) twttr.widgets.load(cards)
  if (!slot) return
  twttr.widgets.load(slot)
  setTimeout(() => {
    // A healthy timeline is a tall iframe; X's "nothing to see here" / rate-limited states are tiny.
    const frame = slot.querySelector('iframe')
    if (frame && frame.offsetHeight > 200) slot.dataset.state = 'rendered'
    else fallback(feed, slot)
  }, TIMELINE_TIMEOUT_MS)
}

let observer
document.addEventListener('astro:page-load', () => {
  observer?.disconnect()
  const feeds = [...document.querySelectorAll('[data-x-feed]:not([data-x-wired])')]
    .filter((feed) => feed.querySelector('[data-x-timeline], [data-x-cards]'))
  if (!feeds.length) return
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer.unobserve(entry.target)
      upgrade(entry.target)
    }
  }, { rootMargin: '300px 0px' })
  feeds.forEach((feed) => {
    feed.dataset.xWired = ''
    observer.observe(feed)
  })
})
