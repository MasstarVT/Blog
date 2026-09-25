import { useCallback, useEffect, useState } from 'react'
import IntroScreen from './IntroScreen.jsx'

// The inline head script in BaseLayout decides (before first paint) whether this visit
// should see the intro, by setting <html data-intro="pending">. This island only renders
// the Website's IntroScreen in that case, and clears the flag when it finishes.
export default function IntroGate() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    if (root.dataset.intro !== 'pending') return
    // 'playing' hides the static black shield; the intro's own curtains take over from here
    root.dataset.intro = 'playing'
    setShow(true)
  }, [])

  // Keep keyboard focus inside the intro while it covers the page
  useEffect(() => {
    const page = document.querySelectorAll('#main, .footer, .nav-container')
    page.forEach((el) => { el.inert = show })
    return () => page.forEach((el) => { el.inert = false })
  }, [show])

  const onComplete = useCallback(() => {
    try { sessionStorage.setItem('masstar:intro', '1') } catch {}
    delete document.documentElement.dataset.intro
    setShow(false)
  }, [])

  return show ? <IntroScreen onComplete={onComplete} /> : null
}
