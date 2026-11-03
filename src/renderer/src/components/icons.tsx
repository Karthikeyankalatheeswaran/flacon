// Stroke icons from the design (24×24, 1.5 stroke, round caps). Decorative: aria-hidden.
const paths = {
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  next: 'M5 6.5v11l8-5.5zM13 6.5v11l7-5.5z',
  prev: 'M19 6.5v11l-8-5.5zM11 6.5v11l-7-5.5z',
  search: 'M16.5 11a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0zM15.5 15.5l4 4',
  flask: 'M9.25 3h5.5M10 3v5.4L5.7 16.2A3.2 3.2 0 0 0 8.5 21h7a3.2 3.2 0 0 0 2.8-4.8L14 8.4V3M7.6 15.4c1.4-1.1 2.9-1.1 4.4 0s3 1.1 4.4 0'
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 16, filled = false }: { name: IconName; size?: number; filled?: boolean }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="ic" style={filled ? { fill: 'currentColor' } : undefined} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
