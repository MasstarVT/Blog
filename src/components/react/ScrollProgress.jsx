import { useScroll, motion } from 'motion/react'

export default function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  return (
    <motion.div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'linear-gradient(90deg, #cc0000, #ff2222, #ff5555)',
        scaleX: scrollYProgress,
        transformOrigin: '0%',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    />
  )
}
