// Smart lists ("Blends"): rule-based playlists the library answers with a filter, never a stored copy.

export const SMART_IDS = ['favorites', 'recent', 'played', 'added', 'verified', 'month', 'upscaled'] as const
export type SmartId = (typeof SMART_IDS)[number]

export interface SmartDef {
  id: SmartId
  label: string
  hint: string
  /** Default sort for the list's songs table. */
  sort: 'title' | 'lastPlayed' | 'plays' | 'added' | 'purity'
  dir: 'asc' | 'desc'
  icon: 'heart' | 'clock' | 'flame' | 'sparkle' | 'seal' | 'calendar' | 'warn'
}

export const SMART: SmartDef[] = [
  { id: 'favorites', label: 'Favourites', hint: 'Songs you hearted', sort: 'added', dir: 'desc', icon: 'heart' },
  { id: 'recent', label: 'Recently played', hint: 'Newest listens first', sort: 'lastPlayed', dir: 'desc', icon: 'clock' },
  { id: 'played', label: 'Most played', hint: 'Your repeat offenders', sort: 'plays', dir: 'desc', icon: 'flame' },
  { id: 'added', label: 'Recently added', hint: 'Newest in your library', sort: 'added', dir: 'desc', icon: 'sparkle' },
  { id: 'verified', label: 'Verified pure', hint: 'Measured 95 % or better', sort: 'purity', dir: 'desc', icon: 'seal' },
  { id: 'month', label: 'Added this month', hint: 'Last 30 days', sort: 'added', dir: 'desc', icon: 'calendar' },
  { id: 'upscaled', label: 'To review', hint: 'Looks upscaled or padded', sort: 'purity', dir: 'asc', icon: 'warn' }
]

export const smartById = (id: string): SmartDef | undefined => SMART.find((s) => s.id === id)

/** A list scope is "all", a smart id, or "playlist:<id>". */
export type ListScope = 'all' | SmartId | `playlist:${number}`
export const SCOPE_RE = /^(all|favorites|recent|played|added|verified|month|upscaled|playlist:\d{1,9})$/
