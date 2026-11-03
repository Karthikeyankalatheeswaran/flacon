import { useStore } from '@/store'
import { Icon } from './icons'

const MAIN = ['Tonight', 'Library', 'Blends', 'Fetch']
const BLENDS = ['Verified only', 'Added this month', 'Most poured', 'Late drives']

export function Rail({ active }: { active: string }): JSX.Element {
  const platform = useStore((s) => s.app?.platform)
  const progress = useStore((s) => s.progress)
  const setPage = useStore((s) => s.setPage)
  const pending = useStore((s) => s.fetchJobs.filter((j) => j.status !== 'done' && j.status !== 'failed' && j.status !== 'canceled').length)
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
        <button key={m} type="button" className="rail-link" aria-current={m === active ? 'page' : undefined}
          onClick={() => (m === 'Library' ? setPage('library') : m === 'Fetch' ? setPage('fetch') : undefined)}>
          <span>{m}</span>
          <span className="t-label ink-2">{m === 'Fetch' && pending > 0 ? pending : ''}</span>
        </button>
      ))}
      <div style={{ height: 24 }} />
      <span className="t-label ink-2" style={{ height: 24, display: 'flex', alignItems: 'center' }}>Blends</span>
      {BLENDS.map((b) => (
        <button key={b} type="button" className="rail-sub">{b}</button>
      ))}
      <div className="rail-foot t-label ink-2">
        {progress.phase === 'scanning' ? (
          <div className="rail-progress" role="status" aria-live="polite">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Scanning</span>
              <span>{progress.total ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : '…'}</span>
            </div>
            <div style={{ height: 1, background: 'var(--rule)' }}>
              <div style={{ height: 1, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--ink)' }} />
            </div>
          </div>
        ) : (
          <button type="button" className="rail-sub" style={{ height: 'auto' }}>Settings</button>
        )}
        {progress.denied.length > 0 && <p style={{ margin: '8px 0 0' }}>Couldn’t read {progress.denied.length} folder{progress.denied.length > 1 ? 's' : ''}. Allow access in System Settings › Privacy.</p>}
      </div>
    </nav>
  )
}
