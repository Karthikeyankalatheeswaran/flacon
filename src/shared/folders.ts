// Folder browsing: pure grouping of track paths into one directory level (tested; the worker feeds it from SQLite).

export interface FolderEntry { name: string; path: string; tracks: number }
export interface FolderTrack { id: number; path: string; title: string; artist: string; durationSec: number }
export interface FolderListing {
  /** Directory shown, or null for the top level (library roots). */
  dir: string | null
  dirs: FolderEntry[]
  tracks: FolderTrack[]
}

/** Path separator used by a stored path (Windows paths keep their backslashes). */
export const sepOf = (p: string): string => (p.includes('\\') && !p.includes('/') ? '\\' : '/')

/** Parent directory within the library roots, or null when `dir` is itself a root (or not under any). */
export function parentDir(dir: string, roots: string[]): string | null {
  if (roots.includes(dir)) return null
  const s = sepOf(dir)
  const i = dir.lastIndexOf(s)
  return i > 0 ? dir.slice(0, i) : null
}

/** Group `rows` (all under `dir`) into immediate sub-directories and the tracks directly inside. */
export function groupLevel(dir: string, rows: FolderTrack[]): { dirs: FolderEntry[]; tracks: FolderTrack[] } {
  const s = sepOf(dir)
  const prefix = dir.endsWith(s) ? dir : dir + s
  const counts = new Map<string, number>()
  const tracks: FolderTrack[] = []
  for (const r of rows) {
    if (!r.path.startsWith(prefix)) continue
    const rest = r.path.slice(prefix.length)
    const i = rest.indexOf(s)
    if (i === -1) tracks.push(r)
    else counts.set(rest.slice(0, i), (counts.get(rest.slice(0, i)) ?? 0) + 1)
  }
  const dirs = [...counts].map(([name, n]) => ({ name, path: prefix + name, tracks: n })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  tracks.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
  return { dirs, tracks }
}

/** SQL LIKE pattern for "everything under dir", escaping %, _ and the escape char. */
export const likeUnder = (dir: string): string => {
  const s = sepOf(dir)
  return (dir.endsWith(s) ? dir : dir + s).replace(/[\\%_]/g, (c) => '\\' + c) + '%'
}
