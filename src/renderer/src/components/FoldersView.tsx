import { useCallback, useEffect, useState } from 'react'
import { sepOf, type FolderListing } from '@shared/folders'
import { timecode } from '@shared/library'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'
import { AddMusic } from './AddMusic'
import { Icon } from './icons'

/** Breadcrumb trail from the library root down to `dir`: [{label, path}], first entry being the root itself. */
function trail(dir: string, roots: string[]): Array<{ label: string; path: string }> {
  const root = roots.find((r) => dir === r || dir.startsWith(r + sepOf(r)) || dir.startsWith(r + '/')) ?? dir
  const s = sepOf(root)
  const out = [{ label: root.split(s).filter(Boolean).pop() ?? root, path: root }]
  let at = root
  for (const part of dir.slice(root.length).split(s).filter(Boolean)) {
    at = at.endsWith(s) ? at + part : at + s + part
    out.push({ label: part, path: at })
  }
  return out
}

/** Folders tab: browse the library as it sits on disk, one level at a time. Enter plays from a track. */
export function FoldersView(): JSX.Element {
  const libraryVersion = useStore((s) => s.libraryVersion)
  const [dir, setDir] = useState<string | null>(null)
  const [roots, setRoots] = useState<string[]>([])
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async (d: string | null) => {
    try {
      const l = await bridge.libraryFolder(d)
      if (d === null) setRoots(l.dirs.map((x) => x.path))
      setListing(l)
      setError(false)
    } catch {
      setError(true)
    }
  }, [])
  useEffect(() => { void load(dir) }, [dir, load, libraryVersion])

  const say = useStore((st) => st.showToast)
  if (error) return <div className="empty" role="alert"><h2 className="t-title">Couldn’t read this folder</h2><p className="ink-2">It may have been moved or its drive is offline.</p><button type="button" className="primary" onClick={() => setDir(null)}>Back to library folders</button></div>
  if (!listing) return <div className="browse" aria-busy="true" aria-label="Loading folders" />
  if (dir === null && !listing.dirs.length) return (
    <div className="empty" role="status">
      <h2 className="t-title">No folders yet</h2>
      <p className="ink-2">Pick a music folder, or drag one onto this window. It stays in your library and updates as you add songs.</p>
      <AddMusic primary />
    </div>
  )

  const paths = listing.tracks.map((t) => t.path)
  const queue = (mode: 'play' | 'shuffle' | 'last'): void => {
    void bridge.libraryPlay({ source: { kind: 'paths', paths }, mode })
    if (mode === 'last') say(`Added ${paths.length} song${paths.length > 1 ? 's' : ''} to the queue`)
  }
  const crumbs = dir === null ? [] : trail(dir, roots)
  return (
    <div className="browse">
      <div className="crumbs">
        <nav aria-label="Folder path" className="crumb-trail">
          <button type="button" className="crumb" aria-current={dir === null ? 'page' : undefined} onClick={() => setDir(null)}>Library folders</button>
          {crumbs.map((c, i) => (
            <span key={c.path} className="crumb-part">
              <Icon name="chevron" size={14} />
              <button type="button" className="crumb" aria-current={i === crumbs.length - 1 ? 'page' : undefined} onClick={() => setDir(c.path)}>{c.label}</button>
            </span>
          ))}
        </nav>
        <span className="crumb-actions">
          {dir !== null && paths.length > 0 && (
            <>
              <button type="button" className="primary" onClick={() => queue('play')}><Icon name="play" size={16} /> Play</button>
              <button type="button" className="ghost-btn" onClick={() => queue('shuffle')}><Icon name="shuffle" size={16} /> Shuffle</button>
              <button type="button" className="ghost-btn" onClick={() => queue('last')}><Icon name="addQueue" size={16} /> Add to queue</button>
            </>
          )}
          <AddMusic />
        </span>
      </div>
      <ul className="list" aria-label={dir ?? 'Library folders'}>
        {listing.dirs.map((d) => (
          <li key={d.path}>
            <button type="button" className="row-btn" onClick={() => setDir(d.path)}>
              <span className="row-main"><Icon name="folder" size={18} /> {d.name}</span>
              <span className="t-label ink-2">{d.tracks.toLocaleString()} songs</span>
            </button>
          </li>
        ))}
        {listing.tracks.map((t, i) => (
          <li key={t.id}>
            <button type="button" className="row-btn" onClick={() => dir !== null && void bridge.libraryPlayFolder(dir, i)}>
              <span className="row-main">{t.title}<span className="ink-2"> {t.artist && `· ${t.artist}`}</span></span>
              <span className="t-label ink-2">{timecode(t.durationSec)}</span>
            </button>
          </li>
        ))}
      </ul>
      {dir !== null && !listing.dirs.length && !listing.tracks.length && <p className="ink-2" role="status">This folder has no songs in your library.</p>}
    </div>
  )
}
