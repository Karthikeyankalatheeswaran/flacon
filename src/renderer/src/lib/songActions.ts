import type { Album } from '@shared/library'
import { bridge } from './bridge'
import { useStore } from '@/store'
import type { MenuItem, SongLike } from './menu'

const plural = (n: number): string => `${n} ${n === 1 ? 'song' : 'songs'}`

/** Context-menu items for one or more songs. `inPlaylist` adds "Remove from playlist" for the given row positions. */
export function songMenu(songs: SongLike[], opts: { inPlaylist?: { id: number; positions: number[] } } = {}): MenuItem[] {
  const s = useStore.getState()
  const playable = songs.filter((x) => !x.offline)
  const paths = playable.map((x) => x.path)
  const one = songs.length === 1 ? songs[0]! : null
  const items: MenuItem[] = [
    { label: 'Play', icon: 'play', disabled: !paths.length, onClick: () => void s.play({ source: { kind: 'paths', paths }, mode: 'play' }) },
    { label: 'Play next', icon: 'playNext', disabled: !paths.length, onClick: () => { void s.play({ source: { kind: 'paths', paths }, mode: 'next' }); s.showToast(`${plural(paths.length)} will play next`) } },
    { label: 'Add to queue', icon: 'addQueue', disabled: !paths.length, onClick: () => { void s.play({ source: { kind: 'paths', paths }, mode: 'last' }); s.showToast(`Added ${plural(paths.length)} to the queue`) } },
    { label: 'Add to playlist…', icon: 'playlist', divider: true, onClick: () => s.setSheet({ kind: 'add-to-playlist', paths: songs.map((x) => x.path) }) }
  ]
  if (one) items.push({ label: one.favorite ? 'Remove from Favourites' : 'Add to Favourites', icon: 'heart', onClick: () => s.toggleFavorite(one.path, !one.favorite) })
  else {
    const allFav = songs.every((x) => x.favorite)
    items.push({ label: allFav ? 'Remove all from Favourites' : 'Add all to Favourites', icon: 'heart', onClick: () => songs.forEach((x) => s.toggleFavorite(x.path, !allFav)) })
  }
  if (one) items.push({ label: 'Show in file manager', icon: 'reveal', onClick: () => bridge.reveal(one.path) })
  if (opts.inPlaylist) {
    const { id, positions } = opts.inPlaylist
    items.push({ label: 'Remove from playlist', icon: 'trash', danger: true, divider: true, onClick: () => void bridge.libraryCall({ op: 'playlistRemove', id, positions }) })
  }
  return items
}

export function albumMenu(a: Pick<Album, 'id' | 'title' | 'offline'>): MenuItem[] {
  const s = useStore.getState()
  const src = { kind: 'album' as const, ids: [a.id] }
  return [
    { label: 'Play', icon: 'play', disabled: a.offline, onClick: () => void s.play({ source: src, mode: 'play' }) },
    { label: 'Shuffle', icon: 'shuffle', disabled: a.offline, onClick: () => void s.play({ source: src, mode: 'shuffle' }) },
    { label: 'Play next', icon: 'playNext', disabled: a.offline, divider: true, onClick: () => { void s.play({ source: src, mode: 'next' }); s.showToast(`“${a.title}” will play next`) } },
    { label: 'Add to queue', icon: 'addQueue', disabled: a.offline, onClick: () => { void s.play({ source: src, mode: 'last' }); s.showToast(`Added “${a.title}” to the queue`) } }
  ]
}
