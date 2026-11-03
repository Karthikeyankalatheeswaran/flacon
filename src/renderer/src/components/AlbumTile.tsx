import type { Album } from '@shared/library'
import { albumMenu } from '@/lib/songActions'
import { useStore } from '@/store'
import { Icon } from './icons'
import { PurityMeter } from './Purity'

/** Small album card for shelves: click plays, right-click for more. */
export function AlbumTile({ album }: { album: Album }): JSX.Element {
  const play = useStore((s) => s.play)
  const openMenu = useStore((s) => s.openMenu)
  return (
    <button type="button" className="tile" disabled={album.offline} onClick={() => void play({ source: { kind: 'album', ids: [album.id] }, mode: 'play' })} onContextMenu={(e) => openMenu(e, albumMenu(album))}
      title={`Play ${album.title}`}>
      <span className="tile-art" style={{ background: album.sleeve }}>
        <span className="tile-play"><Icon name="play" size={18} filled /></span>
      </span>
      <span className="line1" style={{ fontWeight: 600 }} dir="auto">{album.title}</span>
      <span className="line1 ink-2" dir="auto">{album.artist}</span>
      <PurityMeter f={{ purity: album.purity ?? null, lossless: album.quality !== 'lossy', upscaled: album.quality === 'upscaled' }} width={64} />
    </button>
  )
}
