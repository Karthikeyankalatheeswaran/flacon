import { ICON_DATA } from './iconData'

// Phosphor "Light" glyphs (see iconData.ts) plus the Flacon flask mark. Decorative: aria-hidden.
const ALIAS = { next: 'skip-forward', prev: 'skip-back', search: 'magnifying-glass', tonight: 'moon-stars', library: 'books', fetch: 'download-simple', settings: 'gear-six', eq: 'sliders-horizontal',
  volume: 'speaker-high', volumeLow: 'speaker-low', mute: 'speaker-x', lyrics: 'quotes', artists: 'microphone-stage', album: 'vinyl-record', purity: 'waveform', seal: 'seal-check', clock: 'clock-counter-clockwise',
  flame: 'fire', calendar: 'calendar-blank', more: 'dots-three', edit: 'pencil-simple', chevron: 'caret-right', stats: 'chart-bar', addQueue: 'list-plus', playNext: 'arrow-line-right', close: 'x', import: 'upload-simple',
  reveal: 'folder-open', repeatOne: 'repeat-once', sunIcon: 'sun', moonIcon: 'moon', warn: 'warning' } as const

type Base = keyof typeof ICON_DATA
export type IconName = Exclude<Base, `${string}-fill`> | keyof typeof ALIAS | 'flask'

const FLASK = 'M9.25 3h5.5M10 3v5.4L5.7 16.2A3.2 3.2 0 0 0 8.5 21h7a3.2 3.2 0 0 0 2.8-4.8L14 8.4V3M7.6 15.4c1.4-1.1 2.9-1.1 4.4 0s3 1.1 4.4 0'

export function Icon({ name, size = 16, filled = false }: { name: IconName; size?: number; filled?: boolean }): JSX.Element {
  if (name === 'flask') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="ic" aria-hidden="true">
        <path d={FLASK} />
      </svg>
    )
  }
  const base = (name in ALIAS ? ALIAS[name as keyof typeof ALIAS] : name) as Base
  const key = (filled && `${base}-fill` in ICON_DATA ? `${base}-fill` : base) as Base
  return <svg width={size} height={size} viewBox="0 0 256 256" className="ph" fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_DATA[key] }} />
}
