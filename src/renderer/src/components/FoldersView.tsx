import { useCallback, useEffect, useState } from 'react'
import { parentDir, type FolderListing } from '@shared/folders'
import { timecode } from '@shared/library'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'

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

  if (error) return <div className="empty" role="alert"><h2 className="t-title">Couldn’t read this folder</h2><p className="ink-2">It may have been moved or its drive is offline.</p><button type="button" className="primary" onClick={() => setDir(null)}>Back to library folders</button></div>
  if (!listing) return <div className="browse" aria-busy="true" aria-label="Loading folders" />
  if (dir === null && !listing.dirs.length) return <div className="empty" role="status"><h2 className="t-title">No folders yet</h2><p className="ink-2">Add a music folder and it will show up here.</p></div>

  const up = dir === null ? null : parentDir(dir, roots)
  return (
    <div className="browse">
      {dir !== null && (
        <div className="crumbs">
          <button type="button" className="tab" onClick={() => setDir(up)}>← {up === null ? 'Library folders' : 'Up'}</button>
          <h2 className="t-title" style={{ margin: 0, overflowWrap: 'anywhere' }}>{dir}</h2>
        </div>
      )}
      <ul className="list" aria-label={dir ?? 'Library folders'}>
        {listing.dirs.map((d) => (
          <li key={d.path}>
            <button type="button" className="row-btn" onClick={() => setDir(d.path)}>
              <span className="row-main">▸ {d.name}</span>
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
