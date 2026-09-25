import { useEffect, useRef } from 'react'

const COUNT = 35

export default function Particles() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animId = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const particles = Array.from({ length: COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.6,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      opacity: Math.random() * 0.25 + 0.06,
    }))

    const draw = (move) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(220, 30, 30, 1)'
      for (const p of particles) {
        if (move) {
          p.x += p.vx
          p.y += p.vy
          if (p.x < -5) p.x = canvas.width + 5
          else if (p.x > canvas.width + 5) p.x = -5
          if (p.y < -5) p.y = canvas.height + 5
          else if (p.y > canvas.height + 5) p.y = -5
        }
        ctx.globalAlpha = p.opacity
        ctx.fillRect(p.x, p.y, p.size, p.size)
      }
      ctx.globalAlpha = 1
    }

    const tick = () => {
      draw(true)
      animId = requestAnimationFrame(tick)
    }

    // BLOG: stop the loop while the tab is hidden or the visitor prefers reduced motion
    const sync = () => {
      cancelAnimationFrame(animId)
      animId = 0
      if (reduceMotion.matches) draw(false)
      else if (!document.hidden) tick()
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    reduceMotion.addEventListener('change', sync)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', sync)
      reduceMotion.removeEventListener('change', sync)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="particles-canvas"
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}
    />
  )
}
