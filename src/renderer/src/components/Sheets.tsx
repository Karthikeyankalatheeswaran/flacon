import { useEffect, useRef, useState } from 'react'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'
import { Icon } from './icons'

/** Modal sheets: new playlist, rename, and "add to playlist". One at a time, Esc closes, focus starts in the field. */
export function Sheets(): JSX.Element | null {
  const sheet = useStore((s) => s.sheet)
  const setSheet = useStore((s) => s.setSheet)
  const playlists = useStore((s) => s.playlists)
  const show = useStore((s) => s.showToast)
  const openList = useStore((s) => s.openList)
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(sheet?.kind === 'rename-playlist' ? sheet.name : '')
    const t = window.setTimeout(() => input.current?.select(), 0)
    return () => window.clearTimeout(t)
  }, [sheet])
  useEffect(() => {
    if (!sheet) return undefined
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSheet(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, setSheet])
  if (!sheet) return null

  const submit = async (): Promise<void> => {
    const n = name.trim() || 'Untitled playlist'
    if (sheet.kind === 'new-playlist') {
      const id = await bridge.libraryCall<number>({ op: 'playlistCreate', name: n, paths: sheet.paths })
      setSheet(null)
      show(sheet.paths.length ? `Added ${sheet.paths.length} ${sheet.paths.length === 1 ? 'song' : 'songs'} to “${n}”` : `Created “${n}”`)
      openList(`playlist:${id}`)
    } else if (sheet.kind === 'rename-playlist') {
      await bridge.libraryCall({ op: 'playlistRename', id: sheet.id, name: n })
      setSheet(null)
    }
  }
  const addTo = async (id: number, title: string): Promise<void> => {
    if (sheet.kind !== 'add-to-playlist') return
    await bridge.libraryCall({ op: 'playlistAdd', id, paths: sheet.paths })
    setSheet(null)
    show(`Added ${sheet.paths.length} ${sheet.paths.length === 1 ? 'song' : 'songs'} to “${title}”`)
  }

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && setSheet(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="sheet-card" style={{ padding: 28 }}>
        {sheet.kind === 'add-to-playlist' ? (
          <>
            <h2 id="sheet-title" className="t-title" style={{ margin: '0 0 12px' }}>Add to playlist</h2>
            <ul className="plist">
              <li><button type="button" className="row-btn" onClick={() => setSheet({ kind: 'new-playlist', paths: sheet.paths })}><span className="row-main" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="plus" /> New playlist…</span></button></li>
              {playlists.map((p) => (
                <li key={p.id}><button type="button" className="row-btn" onClick={() => void addTo(p.id, p.name)}><span className="row-main">{p.name}</span><span className="t-label ink-2">{p.tracks} songs</span></button></li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button type="button" className="ghost-btn" onClick={() => setSheet(null)}>Cancel</button></div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <h2 id="sheet-title" className="t-title" style={{ margin: '0 0 12px' }}>{sheet.kind === 'new-playlist' ? 'New playlist' : 'Rename playlist'}</h2>
            <input ref={input} className="field" aria-label="Playlist name" placeholder="Name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 20, alignItems: 'center' }}>
              <button type="button" className="ghost-btn" onClick={() => setSheet(null)}>Cancel</button>
              <button type="submit" className="primary" style={{ marginTop: 0 }}>{sheet.kind === 'new-playlist' ? 'Create' : 'Save'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
