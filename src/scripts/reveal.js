// Scroll-reveal for .reveal blocks and .text-reveal headings (static ports of the Website's
// FadeInUp / TextReveal). CSS in blog.css does the animation; this only adds .is-in once.
// It also marks the page as scripted (.reveal-ready / .hydrated), which cancels the CSS failsafe
// that would otherwise reveal everything after 3s.
let observer

function init() {
  document.documentElement.classList.add('reveal-ready', 'hydrated')
  observer?.disconnect()
  const targets = document.querySelectorAll('.reveal:not(.is-in), .text-reveal:not(.is-in)')
  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'))
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-in')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -60px 0px' },
  )
  targets.forEach((el) => observer.observe(el))
}

// On first load astro:page-load waits for window.load (fonts, images); don't keep content hidden that long.
init()
document.addEventListener('astro:page-load', init)
