import { useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react'
import Icon from './Icon.jsx'

// BLOG: icon is passed by name (Astro island props must be serialisable) or as an image URL
export default function LinkCard({ href, className, icon, iconUrl, title, description, internal, delay = 0 }) {
  const ref = useRef(null)
  const [hovered, setHovered] = useState(false)
  const reduce = useReducedMotion()
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const rotateX = useSpring(useTransform(rawY, [-0.5, 0.5], [8, -8]), { stiffness: 320, damping: 30 })
  const rotateY = useSpring(useTransform(rawX, [-0.5, 0.5], [-8, 8]), { stiffness: 320, damping: 30 })

  const magX = useMotionValue(0)
  const magY = useMotionValue(0)
  const sx = useSpring(magX, { stiffness: 380, damping: 28 })
  const sy = useSpring(magY, { stiffness: 380, damping: 28 })

  const onMouseEnter = () => setHovered(true)
  const onMouseMove = (e) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    rawX.set((e.clientX - rect.left) / rect.width - 0.5)
    rawY.set((e.clientY - rect.top) / rect.height - 0.5)
    magX.set((e.clientX - rect.left - rect.width / 2) * 0.08)
    magY.set((e.clientY - rect.top - rect.height / 2) * 0.08)
  }
  const onMouseLeave = () => { rawX.set(0); rawY.set(0); magX.set(0); magY.set(0); setHovered(false) }
  const external = !internal && /^https?:/.test(href)

  return (
    <motion.a
      ref={ref}
      href={href}
      className={`link-card ${className}`}
      title={title}
      aria-label={`${title} — ${description}`}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      style={reduce
        ? { position: 'relative' }
        : { rotateX, rotateY, transformStyle: 'preserve-3d', x: sx, y: sy, zIndex: hovered ? 1 : 0, position: 'relative' }}
      onMouseEnter={reduce ? undefined : onMouseEnter}
      onMouseMove={reduce ? undefined : onMouseMove}
      onMouseLeave={reduce ? undefined : onMouseLeave}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '200px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
      whileTap={{ scale: 0.97 }}
    >
      <div className="link-icon">
        {iconUrl ? <img src={iconUrl} alt="" width="22" height="22" /> : <Icon name={icon} />}
      </div>
      <div className="link-content">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <span className="link-arrow" aria-hidden="true">↗</span>
    </motion.a>
  )
}
