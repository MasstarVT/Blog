import { useRef, useEffect, useState, useCallback } from 'react'
import { motion, useMotionValue, useSpring, useInView, useReducedMotion, MotionConfig } from 'motion/react'
import LiveBadge from './LiveBadge.jsx'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
}

function AnimatedMetric({ value }) {
  const m = value.match(/^(\d+(?:\.\d+)?)(K?)(\+?)$/)
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  // BLOG: server HTML carries the real number (no-JS visitors, crawlers); the count-up resets it after mount
  const [display, setDisplay] = useState(m ? m[1] : value)

  useEffect(() => {
    if (m && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setDisplay('0')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!m || !inView) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDisplay(m[1]); return }
    const target = parseFloat(m[1])
    const decimals = m[1].includes('.') ? 1 : 0
    const dur = Math.min(900 + target * 3, 1600)
    const start = performance.now()
    let raf = 0
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplay((ease * target).toFixed(decimals))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value]) // eslint-disable-line

  if (!m) return <span ref={ref}>{value}</span>
  return <span ref={ref}>{display}{m[2]}{m[3]}</span>
}

function MagneticButton({ href, label, variant, target }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 380, damping: 28 })
  const sy = useSpring(y, { stiffness: 380, damping: 28 })

  const onMove = useCallback((e) => {
    const rect = ref.current.getBoundingClientRect()
    x.set((e.clientX - rect.left - rect.width / 2) * 0.08)
    y.set((e.clientY - rect.top - rect.height / 2) * 0.08)
  }, [x, y])

  const onLeave = useCallback(() => { x.set(0); y.set(0) }, [x, y])

  return (
    <motion.a
      ref={ref}
      href={href}
      className={`cta-button ${variant}`}
      target={target}
      rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      style={reduce ? undefined : { x: sx, y: sy }}
      onMouseMove={reduce ? undefined : onMove}
      onMouseLeave={reduce ? undefined : onLeave}
      whileTap={{ scale: 0.95 }}
    >
      {label}
    </motion.a>
  )
}

// BLOG: adds the live pill to the badges row and takes real metrics from build-time data
export default function ProfileHero({ badges, title, description, tagline, actions, metrics, live, avatar = '/PFP.jpg' }) {
  return (
    <MotionConfig reducedMotion="user">
      <header className="profile-section">
        <div className="profile-media">
          <div className="profile-image">
            <div className="avatar-ring" />
            <motion.img
              src={avatar}
              alt="MasstarVT profile picture"
              className="avatar-img"
              width="120"
              height="120"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              initial={{ opacity: 0, scale: 0.82 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ scale: 1.06, transition: { duration: 0.25 } }}
            />
          </div>
          <div className="media-glow" />
        </div>

        <motion.div className="profile-meta" variants={container} initial="hidden" animate="show">
          <motion.div className="profile-badges" variants={item}>
            <LiveBadge live={live} />
            {badges.map((b) => <span key={b} className="profile-badge">{b}</span>)}
          </motion.div>
          <motion.h1 className="profile-name" variants={item}>{title}</motion.h1>
          <motion.p className="profile-description" variants={item}>{description}</motion.p>
          <motion.p className="profile-tagline" variants={item}>{tagline}</motion.p>
          <motion.div className="profile-actions" variants={item}>
            {actions.map((a) => <MagneticButton key={a.label} {...a} />)}
          </motion.div>
          <motion.ul className="profile-metrics" variants={item} aria-label="Stats">
            {metrics.map(({ value, label, sup }) => (
              <li key={label}>
                <span className="metric-value">
                  {sup && <span className="metric-sup">{sup}</span>}
                  <AnimatedMetric value={value} />
                </span>
                <span className="metric-label">{label}</span>
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </header>
    </MotionConfig>
  )
}
