import { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'

const MC = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*<>/\\|=+-_'
const randChar = () => MC[Math.floor(Math.random() * MC.length)]

const LINES = [
  '> CONNECTING TO MASSTAR.ORG...',
  '> BYPASSING SECURITY PROTOCOLS...',
  '> LOADING IDENTITY MATRIX...',
  '> ACCESS GRANTED',
]

const LOGO = 'MASSTAR'
const CHAR_SPEED = 15

export default function IntroScreen({ onComplete }) {
  const canvasRef = useRef(null)
  const scrambleRef = useRef(null)
  const timersRef = useRef([])
  const skipRef = useRef(null)

  const [typed, setTyped] = useState(LINES.map(() => ''))
  const [lineCount, setLineCount] = useState(0)
  const [logoPhase, setLogoPhase] = useState('hidden')
  const [scrambled, setScrambled] = useState(() => Array(9).fill(null).map(randChar))
  const [leaving, setLeaving] = useState(false)

  const skippedRef = useRef(false)
  const skip = () => {
    if (skippedRef.current) return
    skippedRef.current = true
    timersRef.current.forEach(clearTimeout)
    clearInterval(scrambleRef.current)
    setLeaving(true)
    setTimeout(onComplete, 1000)
  }

  // BLOG: keyboard users can skip too (Escape / Enter / Space), and focus starts on the skip button
  useEffect(() => {
    skipRef.current?.focus({ preventScroll: true })
    const onKey = (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); skip() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Matrix rain canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const FS = 13
    let drops = Array.from({ length: Math.floor(window.innerWidth / FS) }, () => Math.random() * -100)

    const tick = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${FS}px monospace`

      drops.forEach((y, i) => {
        ctx.fillStyle = Math.random() > 0.92 ? '#ff4444' : '#cc0000'
        ctx.fillText(MC[Math.floor(Math.random() * MC.length)], i * FS, y * FS)
        if (y * FS > canvas.height && Math.random() > 0.975) drops[i] = 0
        else drops[i] += 0.5
      })

      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // Terminal sequence
  useEffect(() => {
    const timers = timersRef.current = []
    let cursor = 80

    LINES.forEach((line, li) => {
      timers.push(setTimeout(() => setLineCount(c => Math.max(c, li + 1)), cursor))
      line.split('').forEach((_, ci) => {
        timers.push(setTimeout(() => {
          setTyped(prev => {
            const next = [...prev]
            next[li] = line.slice(0, ci + 1)
            return next
          })
        }, cursor + (ci + 1) * CHAR_SPEED))
      })
      cursor += line.length * CHAR_SPEED + 70
    })

    const logoStart = cursor + 250
    timers.push(setTimeout(() => {
      setLogoPhase('scramble')
      scrambleRef.current = setInterval(() => {
        setScrambled(Array(9).fill(null).map(randChar))
      }, 45)
    }, logoStart))

    timers.push(setTimeout(() => {
      clearInterval(scrambleRef.current)
      setLogoPhase('done')
    }, logoStart + 600))

    const exitAt = logoStart + 600 + 500
    timers.push(setTimeout(() => setLeaving(true), exitAt))
    timers.push(setTimeout(onComplete, exitAt + 950))

    return () => {
      timers.forEach(clearTimeout)
      clearInterval(scrambleRef.current)
    }
  }, [onComplete])

  return (
    <>
      <motion.div
        className="intro-curtain intro-curtain--top"
        animate={{ y: leaving ? '-100%' : 0 }}
        transition={{ duration: 0.78, delay: leaving ? 0.22 : 0, ease: [0.76, 0, 0.24, 1] }}
      />
      <motion.div
        className="intro-curtain intro-curtain--bottom"
        animate={{ y: leaving ? '100%' : 0 }}
        transition={{ duration: 0.78, delay: leaving ? 0.22 : 0, ease: [0.76, 0, 0.24, 1] }}
      />

      <motion.div
        className="intro-stage"
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: 0.3 }}
        onClick={skip}
        style={{ cursor: 'pointer' }}
      >
        <canvas ref={canvasRef} className="matrix-canvas" aria-hidden="true" />
        <button ref={skipRef} type="button" className="intro-skip" onClick={(e) => { e.stopPropagation(); skip() }}>click to skip</button>

        <div className="matrix-terminal" aria-hidden="true">
          <div className="terminal-header">● SECURE TERMINAL v1.0</div>

          <div className="terminal-lines">
            {LINES.slice(0, lineCount).map((line, i) => {
              const granted = i === LINES.length - 1 && typed[i] === line
              return (
                <div key={i} className={`terminal-line${granted ? ' terminal-line--granted' : ''}`}>
                  <span>{typed[i]}</span>
                  {typed[i] !== line && <span className="terminal-cursor">█</span>}
                </div>
              )
            })}
          </div>

          {logoPhase !== 'hidden' && (
            <motion.div
              className="matrix-logo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              {LOGO.split('').map((letter, i) => (
                <span key={i} className={`matrix-letter${logoPhase === 'done' ? ' matrix-letter--done' : ''}`}>
                  {logoPhase === 'done' ? letter : scrambled[i]}
                </span>
              ))}
              <span className={`matrix-letter matrix-letter--vt${logoPhase === 'done' ? ' matrix-letter--done' : ''}`}>
                {logoPhase === 'done' ? 'VT' : (scrambled[7] + scrambled[8])}
              </span>
            </motion.div>
          )}
        </div>
      </motion.div>
    </>
  )
}
