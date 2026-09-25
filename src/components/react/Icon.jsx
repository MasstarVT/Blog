import { icons } from '../../config/icons.mjs'

export default function Icon({ name, size = 22, className, title }) {
  const icon = icons[name]
  if (!icon) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="currentColor"
      className={className}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={icon.d} fillRule={icon.fillRule} />
    </svg>
  )
}
