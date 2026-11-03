import { useState } from 'react'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'
import { Icon } from './icons'

export function PlaylistsPage(): JSX.Element {
  const playlists = useStore((s) => s.playlists)
  const openList = useStore((s) => s.openList)
  const setSheet = useStore((s) => s.setSheet)
  const show = useStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const importIt = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await bridge.playlistIo({ op: 'import' })
      if (r.message) show(r.message)
    } finally { setBusy(false) }
  }
  return (
    <>
      <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', flexShrink: 0 }} />
      <div className="page-head">
        <h1 className="t-display">Playlists</h1>
        <div className="page-actions">
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void importIt()}><Icon name="import" size={16} /> Import M3U…</button>
          <button type="button" className="primary" style={{ marginTop: 0 }} onClick={() => setSheet({ kind: 'new-playlist', paths: [] })}><Icon name="plus" size={16} /> New playlist</button>
        </div>
      </div>
      {playlists.length === 0 ? (
        <div className="empty" role="status">
          <h2 className="t-title">No playlists yet</h2>
          <p className="ink-2">Make one, then right-click any song and choose Add to playlist. You can also import an M3U or M3U8 playlist from another player.</p>
        </div>
      ) : (
        <div className="page-scroll">
          <div className="pl-grid">
            {playlists.map((p) => (
              <button key={p.id} type="button" className="tile" onClick={() => openList(`playlist:${p.id}`)}>
                <span className="tile-art" style={{ background: p.sleeve }}><span className="tile-play"><Icon name="playlist" size={20} /></span></span>
                <span className="line1" style={{ fontWeight: 600 }} dir="auto">{p.name}</span>
                <span className="line1 ink-2">{p.tracks} {p.tracks === 1 ? 'song' : 'songs'}{p.minutes ? ` · ${p.minutes} min` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
