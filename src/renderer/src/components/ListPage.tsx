import { useEffect, useState } from 'react'
import { smartById } from '@shared/smart'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'
import { Icon } from './icons'
import { SongsTable } from './SongsTable'

/** A smart list (Blends) or a user playlist: header actions plus the songs table scoped to it. */
export function ListPage(): JSX.Element {
  const scope = useStore((s) => s.scope)
  const playlists = useStore((s) => s.playlists)
  const play = useStore((s) => s.play)
  const setSheet = useStore((s) => s.setSheet)
  const setPage = useStore((s) => s.setPage)
  const show = useStore((s) => s.showToast)
  const [filter, setFilter] = useState('')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { setFilter(''); setConfirm(false) }, [scope])

  const smart = smartById(scope)
  const plId = scope.startsWith('playlist:') ? Number(scope.slice(9)) : undefined
  const pl = plId ? playlists.find((p) => p.id === plId) : undefined
  const title = smart?.label ?? pl?.name ?? 'Playlist'
  const sub = smart?.hint ?? (pl ? `${pl.tracks} ${pl.tracks === 1 ? 'song' : 'songs'}${pl.minutes ? ` · ${pl.minutes} min` : ''}` : '')

  if (plId && !pl) {
    // Deleted from elsewhere (or still loading): don't show an orphaned table.
    return <div className="empty" role="status"><h2 className="t-title">This playlist is gone</h2><button type="button" className="primary" onClick={() => setPage('playlists')}>All playlists</button></div>
  }
  const src = { kind: 'scope' as const, scope, text: '' }
  return (
    <>
      <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <label className="search no-drag">
          <Icon name="search" />
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this list" aria-label="Filter this list" spellCheck={false} />
        </label>
      </div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="t-display ell" style={{ margin: 0 }} dir="auto">{title}</h1>
          <div className="t-label ink-2" style={{ margin: '4px 0 16px' }}>{sub}</div>
        </div>
        <div className="page-actions">
          <button type="button" className="primary" style={{ marginTop: 0 }} onClick={() => void play({ source: src, mode: 'play' })}><Icon name="play" size={16} filled /> Play</button>
          <button type="button" className="ghost-btn" onClick={() => void play({ source: src, mode: 'shuffle' })}><Icon name="shuffle" size={16} /> Shuffle</button>
          {pl && (
            <>
              <button type="button" className="ghost-btn" onClick={() => setSheet({ kind: 'rename-playlist', id: pl.id, name: pl.name })}><Icon name="edit" size={16} /> Rename</button>
              <button type="button" className="ghost-btn" onClick={() => void bridge.playlistIo({ op: 'export', id: pl.id }).then((r) => r.message && show(r.message))}><Icon name="export" size={16} /> Export</button>
              {confirm ? (
                <span role="group" aria-label="Delete this playlist?" style={{ display: 'flex', gap: 12 }}>
                  <button type="button" className="ghost-btn" style={{ color: 'var(--err)' }} onClick={() => void bridge.libraryCall({ op: 'playlistDelete', id: pl.id }).then(() => setPage('playlists'))}>Delete playlist</button>
                  <button type="button" className="ghost-btn" onClick={() => setConfirm(false)}>Keep</button>
                </span>
              ) : <button type="button" className="ghost-btn" onClick={() => setConfirm(true)}><Icon name="trash" size={16} /> Delete</button>}
            </>
          )}
        </div>
      </div>
      <SongsTable key={scope} text={filter} scope={scope} initialSort={(plId ? 'position' : smart?.sort ?? 'title')} initialDir={plId ? 'asc' : smart?.dir ?? 'asc'} playlistId={plId} />
    </>
  )
}
