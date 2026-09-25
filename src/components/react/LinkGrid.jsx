import { MotionConfig } from 'motion/react'
import LinkCard from './LinkCard.jsx'

// One island for a whole grid of link cards.
// variant 'dock' renders every link inside one .links-section--dock (icon circles, like masstar.org's home);
// variant 'full' renders one titled panel per group (the /links page).
export default function LinkGrid({ links, groups, variant = 'full' }) {
  const byGroup = groups.map((g) => ({ ...g, links: links.filter((l) => l.group === g.key) })).filter((g) => g.links.length)

  return (
    <MotionConfig reducedMotion="user">
      <div className={`links-section${variant === 'dock' ? ' links-section--dock' : ''}`}>
        {byGroup.map((group) => (
          <section key={group.key} className="links-category glow-panel" data-glow>
            <div className="section-heading">
              <h2 className="category-title">{group.title}</h2>
              <p className="category-subtitle">{group.subtitle}</p>
            </div>
            <div className="links-grid">
              {group.links.map(({ key: brand, group: _group, ...link }, i) => (
                <LinkCard key={link.href} className={brand} delay={i * 0.05} {...link} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </MotionConfig>
  )
}
