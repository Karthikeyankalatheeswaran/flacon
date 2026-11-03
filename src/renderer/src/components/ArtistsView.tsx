import { useMemo, useState } from 'react'
import { groupArtists } from '@shared/artists'
import type { Album } from '@shared/library'
import { useStore } from '@/store'
import { AlbumGrid } from './AlbumGrid'
import { Icon } from './icons'

interface Props {
  albums: Album[]
  vesselLeft: () => number
  onDragState: (over: boolean) => void
  onPour: (a: Album) => void
  onPlay: (a: Album) => void
}

/** Artists tab: an A–Z index of album artists; opening one shows their albums in the usual grid. */
export function ArtistsView({ albums, vesselLeft, onDragState, onPour, onPlay }: Props): JSX.Element {
  const artists = useMemo(() => groupArtists(albums), [albums])
  const [open, setOpen] = useState<string | null>(null)
  const current = open === null ? null : artists.find((a) => a.name === open)
  const play = useStore((s) => s.play)

  if (current) {
    return (
      <div className="browse">
        <div className="crumbs">
          <button type="button" className="tab" onClick={() => setOpen(null)}>← All artists</button>
          <h2 className="t-title" style={{ margin: 0 }}>{current.name}</h2>
          <span className="t-label ink-2">{current.albums.length} {current.albums.length === 1 ? 'album' : 'albums'}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
            <button type="button" className="ghost-btn" onClick={() => void play({ source: { kind: 'artist', name: current.name }, mode: 'play' })}><Icon name="play" size={16} filled /> Play</button>
            <button type="button" className="ghost-btn" onClick={() => void play({ source: { kind: 'artist', name: current.name }, mode: 'shuffle' })}><Icon name="shuffle" size={16} /> Shuffle</button>
          </span>
        </div>
        <AlbumGrid albums={current.albums} vesselLeft={vesselLeft} onDragState={onDragState} onPour={onPour} onPlay={onPlay} />
      </div>
    )
  }
  if (!artists.length) return <div className="empty" role="status"><h2 className="t-title">No artists yet</h2><p className="ink-2">Artists appear once your library has been read.</p></div>
  return (
    <ul className="browse list" aria-label="Artists">
      {artists.map((a) => (
        <li key={a.name}>
          <button type="button" className="row-btn" onClick={() => setOpen(a.name)}>
            <span className="row-main">{a.name}</span>
            <span className="t-label ink-2">{a.albums.length} {a.albums.length === 1 ? 'album' : 'albums'} · {a.tracks.toLocaleString()} songs</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
