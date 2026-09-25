// Mouse-follow glow for [data-glow] panels (static port of the Website's GlowPanel component).
const wired = new WeakSet()

function wire(el) {
  if (wired.has(el)) return
  wired.add(el)
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--gx', `${((e.clientX - rect.left) / rect.width) * 100}%`)
    el.style.setProperty('--gy', `${((e.clientY - rect.top) / rect.height) * 100}%`)
    el.style.setProperty('--go', '1')
  })
  el.addEventListener('pointerleave', () => el.style.setProperty('--go', '0'))
}

const wireAll = () => document.querySelectorAll('[data-glow]').forEach(wire)
wireAll()
document.addEventListener('astro:page-load', wireAll)
