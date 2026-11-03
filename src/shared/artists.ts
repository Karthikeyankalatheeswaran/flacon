import type { Album } from './library'

export interface ArtistGroup { name: string; albums: Album[]; tracks: number }

/** Group albums by album artist. Case/diacritic-insensitive identity, first spelling wins; "Various Artists" sorts last. */
export function groupArtists(albums: Album[]): ArtistGroup[] {
  const norm = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
  const map = new Map<string, ArtistGroup>()
  for (const a of albums) {
    const name = a.artist.trim() || 'Unknown artist'
    const key = norm(name)
    const g = map.get(key) ?? { name, albums: [], tracks: 0 }
    g.albums.push(a)
    g.tracks += a.trackCount ?? 0
    map.set(key, g)
  }
  const va = (n: string): number => (norm(n) === 'various artists' ? 1 : 0)
  return [...map.values()].sort((x, y) => va(x.name) - va(y.name) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }))
}
