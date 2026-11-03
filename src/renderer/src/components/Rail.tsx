import { useStore } from '@/store'
import { Icon } from './icons'

const MAIN = [
  { label: 'Tonight', n: '' },
  { label: 'Library', n: '' },
  { label: 'Blends', n: '' },
  { label: 'Fetch', n: '3' }
]
const BLENDS = ['Verified only', 'Added this month', 'Most poured', 'Late drives']

export function Rail({ active }: { active: string }): JSX.Element {
  const platform = useStore((s) => s.app?.platform)
  const mac = platform !== 'win32'
  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-top">
        {/* mac: native traffic lights are drawn by the OS (hiddenInset); reserve their width.
            Windows: wordmark here, caption buttons sit top-right via titleBarOverlay. */}
        {mac ? <span style={{ width: 52 }} /> : (
          <>
            <Icon name="flask" size={16} />
            <span style={{ fontStretch: '125%', fontSize: 13 }}>flacon</span>
          </>
        )}
      </div>
      <div style={{ height: 20 }} />
      {MAIN.map((m) => (
        <button key={m.label} type="button" className="rail-link" aria-current={m.label === active ? 'page' : undefined}>
          <span>{m.label}</span>
          <span className="t-label ink-2">{m.n}</span>
        </button>
      ))}
      <div style={{ height: 24 }} />
      <span className="t-label ink-2" style={{ height: 24, display: 'flex', alignItems: 'center' }}>Blends</span>
      {BLENDS.map((b) => (
        <button key={b} type="button" className="rail-sub">{b}</button>
      ))}
      <div className="rail-foot t-label ink-2">
        <button type="button" className="rail-sub" style={{ height: 'auto' }}>Settings</button>
      </div>
    </nav>
  )
}
