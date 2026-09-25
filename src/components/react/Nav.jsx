import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'motion/react'
import { useLive } from '../../lib/live-store.js'

const links = [
  { to: '/', label: 'Home' },
  { to: '/blog/', label: 'Blog' },
  { to: '/schedule/', label: 'Schedule' },
  { to: '/links/', label: 'Links' },
  { to: 'https://masstar.org', label: 'masstar.org ↗', external: true },
]

// BLOG: the nav is persisted across ClientRouter navigations, so track the path from Astro's events
function usePathname(initial) {
  const [pathname, setPathname] = useState(initial)
  useEffect(() => {
    const update = () => setPathname(window.location.pathname)
    update()
    document.addEventListener('astro:after-swap', update)
    return () => document.removeEventListener('astro:after-swap', update)
  }, [])
  return pathname
}

const isActive = (pathname, to) => (to === '/' ? pathname === '/' : pathname.startsWith(to))

export default function Nav({ pathname: initialPath = '/', live: initialLive }) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname(initialPath)
  const live = useLive(initialLive)
  const closingForNav = useRef(false)
  const openRef = useRef(false)
  const hamburgerRef = useRef(null)
  const closeRef = useRef(null)

  // Close for navigation only when the menu is actually open, otherwise the flag would stick
  const closeForNavigation = () => {
    if (!openRef.current) return
    closingForNav.current = true
    setIsOpen(false)
  }

  useEffect(() => { closeForNavigation() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    openRef.current = isOpen
    // BLOG: the rest of the page is inert while the sidebar dialog is open
    const background = document.querySelectorAll('#main, .footer, .nav-container')
    if (isOpen) {
      const scrollY = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${scrollY}px`
      background.forEach((el) => { el.inert = true })
      closeRef.current?.focus({ preventScroll: true })
    } else {
      const top = document.body.style.top
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      background.forEach((el) => { el.inert = false })
      if (top && !closingForNav.current) {
        window.scrollTo({ top: parseInt(top) * -1, behavior: 'instant' })
        hamburgerRef.current?.focus({ preventScroll: true })
      }
      closingForNav.current = false
    }
  }, [isOpen])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false) }
    const onNavigate = () => closeForNavigation()
    document.addEventListener('keydown', onKey)
    document.addEventListener('astro:before-preparation', onNavigate)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('astro:before-preparation', onNavigate)
    }
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <motion.nav
        className="nav-container"
        aria-label="Main"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <a href="/" className="site-logo" aria-label="MasstarVT blog home">
          <span className="logo-mark">Masstar</span>
          <span className="logo-accent">VT</span>
          <span className="logo-sub">Blog</span>
        </a>
        <div className="nav-right">
          {live.isLive && (
            <a className="nav-live" href="https://twitch.tv/masstarvt" target="_blank" rel="noopener noreferrer" title={live.title || 'Live on Twitch'}>
              <span className="live-dot" aria-hidden="true" />
              LIVE
            </a>
          )}
          <ul className="nav-links">
            {links.map(({ to, label, external }) => (
              <li key={to}>
                <a
                  href={to}
                  className={`nav-link${!external && isActive(pathname, to) ? ' active' : ''}`}
                  aria-current={!external && isActive(pathname, to) ? 'page' : undefined}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <button
            ref={hamburgerRef}
            className={`hamburger-menu${isOpen ? ' is-active' : ''}`}
            onClick={() => setIsOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={isOpen}
            aria-controls="site-sidebar"
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>
        </div>
      </motion.nav>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="sidebar-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              id="site-sidebar"
              className="sidebar"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            >
              <div className="sidebar-header">
                <h3>Navigation</h3>
                <button
                  ref={closeRef}
                  className="close-sidebar"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close navigation menu"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
              <nav className="sidebar-nav" aria-label="Sidebar">
                {links.map(({ to, label, external }, i) => (
                  <motion.div
                    key={to}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.06 + i * 0.07, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <a
                      href={to}
                      className={`sidebar-link${!external && isActive(pathname, to) ? ' active' : ''}`}
                      aria-current={!external && isActive(pathname, to) ? 'page' : undefined}
                      target={external ? '_blank' : undefined}
                      rel={external ? 'noopener noreferrer' : undefined}
                      onClick={() => { if (!external) closingForNav.current = true; setIsOpen(false) }}
                    >
                      {label}
                    </a>
                  </motion.div>
                ))}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}
