import { SMART } from '@shared/smart'
import { useStore, type Page } from '@/store'
import { Icon, type IconName } from './icons'

const MAIN: Array<{ page: Page; label: string; icon: IconName }> = [
  { page: 'home', label: 'Tonight', icon: 'tonight' },
  { page: 'library', label: 'Library', icon: 'library' },
  { page: 'fetch', label: 'Fetch', icon: 'fetch' },
  { page: 'stats', label: 'Listening', icon: 'stats' }
]

export function Rail(): JSX.Element {
  const platform = useStore((s) => s.app?.platform)
  const progress = useStore((s) => s.progress)
  const analysis = useStore((s) => s.analysis)
  const page = useStore((s) => s.page)
  const scope = useStore((s) => s.scope)
  const setPage = useStore((s) => s.setPage)
  const openList = useStore((s) => s.openList)
  const setSheet = useStore((s) => s.setSheet)
  const playlists = useStore((s) => s.playlists)
  const pending = useStore((s) => s.fetchJobs.filter((j) => j.status !== 'done' && j.status !== 'failed' && j.status !== 'canceled').length)
  const mac = platform !== 'win32'
  const here = (p: Page): boolean => page === p
  const onList = (sc: string): boolean => page === 'list' && scope === sc

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
      <div className="rail-body">
        <div className="rail-group">
          {MAIN.map((m) => (
            <button key={m.page} type="button" className="rail-link" aria-current={here(m.page) ? 'page' : undefined} onClick={() => setPage(m.page)}>
              <Icon name={m.icon} size={18} />
              <span>{m.label}</span>
              {m.page === 'fetch' && pending > 0 && <span className="t-label rail-count">{pending}</span>}
            </button>
          ))}
        </div>
        <div className="rail-head t-label ink-2">Blends</div>
        <div className="rail-group">
          {SMART.map((d) => (
            <button key={d.id} type="button" className="rail-sub" aria-current={onList(d.id) ? 'page' : undefined} onClick={() => openList(d.id)}>
              <Icon name={d.icon} size={16} filled={d.icon === 'heart' && onList(d.id)} />
              <span className="ell">{d.label}</span>
            </button>
          ))}
        </div>
        <div className="rail-head t-label ink-2">
          <button type="button" className="rail-title-btn" aria-current={here('playlists') ? 'page' : undefined} onClick={() => setPage('playlists')}>Playlists</button>
          <button type="button" className="rail-plus" aria-label="New playlist" title="New playlist (⌘N)" onClick={() => setSheet({ kind: 'new-playlist', paths: [] })}><Icon name="plus" size={16} /></button>
        </div>
        <div className="rail-group">
          {playlists.length === 0 && <p className="t-label ink-2" style={{ margin: '2px 0 0' }}>No playlists yet.</p>}
          {playlists.map((p) => (
            <button key={p.id} type="button" className="rail-sub" aria-current={onList(`playlist:${p.id}`) ? 'page' : undefined} onClick={() => openList(`playlist:${p.id}`)}>
              <Icon name="playlist" size={16} />
              <span className="ell">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rail-foot t-label ink-2">
        {progress.phase === 'scanning' ? (
          <div className="rail-progress" role="status" aria-live="polite">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Reading folders</span>
              <span>{progress.total ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : '…'}</span>
            </div>
            <div style={{ height: 1, background: 'var(--rule)' }}>
              <div style={{ height: 1, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--ink)' }} />
            </div>
          </div>
        ) : analysis.total > analysis.done ? (
          <div className="rail-progress" role="status" aria-live="off" title="Flacon decodes a short sample of every lossless song to measure how much of its frequency range is real.">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Measuring purity</span>
              <span>{analysis.done.toLocaleString()} / {analysis.total.toLocaleString()}</span>
            </div>
            <div style={{ height: 1, background: 'var(--rule)' }}>
              <div style={{ height: 1, width: `${(analysis.done / Math.max(1, analysis.total)) * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
        ) : null}
        <button type="button" className="rail-sub" style={{ marginTop: 8 }} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}>
          <Icon name="settings" size={16} /><span>Settings</span>
        </button>
        {progress.denied.length > 0 && <p style={{ margin: '8px 0 0' }}>Couldn’t read {progress.denied.length} folder{progress.denied.length > 1 ? 's' : ''}. Allow access in System Settings › Privacy.</p>}
      </div>
    </nav>
  )
}
