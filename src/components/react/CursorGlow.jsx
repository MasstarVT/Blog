import { useEffect } from 'react'
import { motion, useMotionValue, useSpring } from 'motion/react'

export default function CursorGlow() {
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const x = useSpring(mouseX, { stiffness: 55, damping: 22 })
  const y = useSpring(mouseY, { stiffness: 55, damping: 22 })

  useEffect(() => {
    const move = (e) => {
      mouseX.set(e.clientX)
      mouseY.set(e.clientY)
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [mouseX, mouseY])

  return (
    <motion.div
      className="cursor-glow"
      style={{ x, y }}
      aria-hidden="true"
    />
  )
}
