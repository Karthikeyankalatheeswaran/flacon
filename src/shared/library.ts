// Library data model shared by main, workers and renderers. Milestone 3 fills this from SQLite;
// until then the renderer seeds from `sampleAlbums` (the specimens from design board C4).

export type Quality = 'hires' | 'cd' | 'upscaled' | 'lossy'

export interface Album {
  id: string
  title: string
  artist: string
  /** CSS background for placeholder sleeves; real artwork replaces this at scan time. */
  sleeve: string
  sleeveText?: string
  sleeveTextColor?: string
  bigGlyph?: string
  bigGlyphColor?: string
  quality: Quality
  /** Measured spectral ceiling in kHz (design: "fill line"). */
  ceilingKhz: number
  minutes: number
  offline?: boolean
  tint: string
  trackCount?: number
  /** Mean measured purity of the album's tracks; null until measured. */
  purity?: number | null
  /** Plain art URL; undefined/null when the album has no artwork. */
  artUrl?: string | null
}

export const CD_LIMIT_KHZ = 22.05

/** Fill-line width: share of the spectrum actually present (design C1). */
export function fillPercent(a: Pick<Album, 'quality'>): number {
  if (a.quality === 'hires') return 99
  if (a.quality === 'upscaled') return 41
  if (a.quality === 'lossy') return 33
  return 45.9
}

export function qualityLabel(a: Album): string {
  if (a.offline) return 'Unavailable · drive offline'
  const ceil = `ceiling ${a.ceilingKhz} kHz`
  switch (a.quality) {
    case 'upscaled':
      return `Claims 24/96 · ${ceil}`
    case 'lossy':
      return `AAC 256 · lossy`
    case 'hires':
      return `24 bit · ${ceil}`
    case 'cd':
      return `16/44.1 · ${ceil}`
  }
}

/** m:ss under an hour, h:mm:ss above (handoff: timecodes). */
export function timecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function durationLabel(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes} min`
}

export const sampleAlbums: Album[] = [
  { id: 'a1', title: 'Low Tide Hymns', artist: 'Salt & Ember', quality: 'hires', ceilingKhz: 47.6, minutes: 52, tint: '#13303A',
    sleeve: 'radial-gradient(circle at 68% 38%,#E9C46A 0 11%,transparent 11.5%),linear-gradient(180deg,#1F4250 0 58%,#D9CBB0 58% 59.5%,#16323D 59.5%)',
    sleeveText: 'SALT & EMBER', sleeveTextColor: '#D9CBB0' },
  { id: 'a2', title: '夜の温室', artist: 'Kaito Mori', quality: 'hires', ceilingKhz: 47.9, minutes: 44, tint: '#5A1F37',
    sleeve: 'linear-gradient(#D1497A,#D1497A) 62% 30%/18% 26% no-repeat,repeating-linear-gradient(90deg,rgba(255,255,255,.09) 0 1px,transparent 1px 14%),#0E2A22',
    sleeveText: '夜の温室', sleeveTextColor: 'rgba(255,255,255,.7)' },
  { id: 'a3', title: 'Goldberg Variations, BWV 988', artist: 'J. S. Bach — Mira Solberg', quality: 'hires', ceilingKhz: 95.1, minutes: 78, tint: '#3A3832',
    sleeve: '#EFECE4', bigGlyph: '988', bigGlyphColor: '#141413', sleeveText: 'BACH · SOLBERG', sleeveTextColor: '#141413' },
  { id: 'a4', title: 'Quiet Machines', artist: 'Ines Varga', quality: 'cd', ceilingKhz: 22.05, minutes: 39, tint: '#6B2A12',
    sleeve: 'radial-gradient(circle,#1A1A1A 0 30%,transparent 33%) 0 0/9px 9px,#E8622C' },
  { id: 'a5', title: 'Station to Nowhere', artist: 'Various Artists', quality: 'upscaled', ceilingKhz: 19.8, minutes: 61, tint: '#2C3314',
    sleeve: 'conic-gradient(from 90deg at 40% 60%,#2C2C2C 0 25%,#C8D24A 0 50%,#F1EFE8 0 75%,#5B6B2E 0)' },
  { id: 'a6', title: 'ليالي البحر', artist: 'نور حداد', quality: 'cd', ceilingKhz: 22.05, minutes: 41, tint: '#4A2E12',
    sleeve: '#C9A36A', bigGlyph: 'ل', bigGlyphColor: '#4A2E12', sleeveText: 'نور حداد', sleeveTextColor: '#4A2E12' },
  { id: 'a7', title: 'Field Recordings, Vol. 2', artist: 'Hollow Pines', quality: 'hires', ceilingKhz: 23.9, minutes: 33, tint: '#27414F',
    sleeve: 'radial-gradient(circle at 50% 46%,#F4F4F1 0 18%,transparent 18.5%),repeating-linear-gradient(0deg,#9CB7C9 0 2px,#DCE6EC 2px 9px)' },
  { id: 'a8', title: 'Club Mix 03 (3 h 12 m)', artist: 'DJ Ferro', quality: 'lossy', ceilingKhz: 16, minutes: 192, tint: '#3A0F24',
    sleeve: 'radial-gradient(circle,transparent 0 30%,#FF3D8B 30% 31.5%,transparent 32%),#0A0A0A', sleeveText: 'FERRO / 03', sleeveTextColor: '#FF3D8B' },
  { id: 'a9', title: 'String Quartets 1–15', artist: 'Shostakovich — Halden Quartet', quality: 'hires', ceilingKhz: 47.2, minutes: 401, tint: '#5A1A15',
    sleeve: 'linear-gradient(135deg,transparent 0 48%,#111 48% 60%,transparent 60%),#9E2A22', bigGlyph: '15', bigGlyphColor: '#F1EFE8' },
  { id: 'a10', title: 'track07', artist: 'rips/2003-live', quality: 'cd', ceilingKhz: 22.05, minutes: 47, tint: '#262725',
    sleeve: 'linear-gradient(135deg,#E6E6E2 0 50%,#D2D2CD 50%)', sleeveText: 'TRACK07.FLAC', sleeveTextColor: 'rgba(20,20,19,.55)' },
  { id: 'a11', title: 'Archive Sessions', artist: 'Salt & Ember · NAS offline', quality: 'cd', ceilingKhz: 22.05, minutes: 58, offline: true, tint: '#13303A',
    sleeve: 'linear-gradient(180deg,#1F4250 0 50%,#16323D 50%)', sleeveText: 'ARCHIVE', sleeveTextColor: '#D9CBB0' },
  { id: 'a12', title: 'Pilot Light — Single', artist: 'Salt & Ember', quality: 'hires', ceilingKhz: 47.1, minutes: 5, tint: '#16323D',
    sleeve: 'radial-gradient(circle at 30% 70%,#E9C46A 0 16%,transparent 16.5%),#16323D' }
]

// ---- Library worker protocol (main ⇄ worker) and renderer-facing shapes ----

export interface LibraryProgress {
  phase: 'idle' | 'scanning'
  done: number
  total: number
  /** Folders the OS would not let us read (macOS Full Disk Access / folder prompts). */
  denied: string[]
}

export interface LibraryTrack {
  id: number
  path: string
  title: string
  artist: string
  album: string
  disc: number
  track: number
  durationSec: number
}

export type LibraryRequest =
  | { op: 'init'; dbPath: string; artDir: string; ffmpeg: string }
  | { op: 'folders' }
  | { op: 'addFolder'; path: string }
  | { op: 'removeFolder'; path: string }
  | { op: 'scan' }
  | { op: 'albums' }
  | { op: 'albumTracks'; albumId: number }
  | { op: 'search'; query: string }
  | { op: 'songs'; query: SongsQuery }
  | { op: 'folder'; dir: string | null }
  | { op: 'cueRefs'; paths: string[] }
  | { op: 'trackMetas'; paths: string[] }
  | { op: 'setFavorite'; path: string; value: boolean }
  | { op: 'setRating'; path: string; value: number }
  | { op: 'recordPlay'; path: string; secs: number }
  | { op: 'playlists' }
  | { op: 'playlistCreate'; name: string; paths: string[] }
  | { op: 'playlistRename'; id: number; name: string }
  | { op: 'playlistDelete'; id: number }
  | { op: 'playlistAdd'; id: number; paths: string[] }
  | { op: 'playlistRemove'; id: number; positions: number[] }
  | { op: 'playlistMove'; id: number; from: number; to: number }
  | { op: 'playlistPaths'; id: number }
  | { op: 'playlistImport'; name: string; paths: string[] }
  | { op: 'scopePaths'; scope: string; text: string; limit: number }
  | { op: 'albumPaths'; albumIds: number[] }
  | { op: 'artistPaths'; artist: string }
  | { op: 'lyrics'; path: string }
  | { op: 'home' }
  | { op: 'stats' }
  | { op: 'analysisProgress' }

/** Convert a stored art filename into a URL served by the flacon-art:// protocol. */
export const artUrl = (name: string): string => `flacon-art://art/${name}`

const HEX6 = /^#[0-9a-f]{6}$/i
/** Mix a #rrggbb colour toward white by `amount` (0–1): the lit corner of a placeholder sleeve. */
function lift(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number): string => Math.round(((n >> shift) & 255) * (1 - amount) + 255 * amount).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

/**
 * CSS `background` for an album with no artwork: the album's tint fading to near-black, with fine concentric
 * record rings and a centre dot. Deterministic, dependency-free and quiet enough to sit beside real covers.
 */
export function placeholderSleeve(tint: string): string {
  const base = HEX6.test(tint) ? tint : '#3a3d3a'
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='xMidYMid slice'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${lift(base, 0.22)}'/><stop offset='.55' stop-color='${base}'/><stop offset='1' stop-color='#111211'/></linearGradient></defs>` +
    `<rect width='100' height='100' fill='url(#g)'/>` +
    `<g fill='none' stroke='#fff' stroke-width='.5'><circle cx='50' cy='50' r='38' stroke-opacity='.10'/><circle cx='50' cy='50' r='30' stroke-opacity='.14'/><circle cx='50' cy='50' r='22' stroke-opacity='.18'/><circle cx='50' cy='50' r='14' stroke-opacity='.22'/></g>` +
    `<circle cx='50' cy='50' r='2.6' fill='#fff' fill-opacity='.55'/></svg>`
  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/"/g, "'")}") center/cover no-repeat, ${base}`
}

// ---- Songs table ----

export const SONG_SORTS = ['title', 'artist', 'album', 'duration', 'quality', 'added', 'purity', 'plays', 'lastPlayed', 'rating', 'position'] as const
export type SongSort = (typeof SONG_SORTS)[number]

export interface SongsQuery {
  sort: SongSort
  dir: 'asc' | 'desc'
  /** Free-text filter (FTS5); empty = all songs. */
  text: string
  /** Which list: everything, a smart list ("favorites"…) or "playlist:<id>". */
  scope?: string
  offset: number
  limit: number
}

export interface LibrarySong {
  id: number
  path: string
  title: string
  artist: string
  album: string
  durationSec: number
  quality: Quality
  sampleRate: number
  bitDepth: number | null
  codec: string
  offline: boolean
  /** Sleeve placeholder/art for the 32px thumbnail. */
  sleeve: string
  /** Another file in the library has the same title, artist and duration (design: duplicates). */
  duplicate: boolean
  /** Plain art URL for <img> / the island; null when the album has no artwork. */
  artUrl: string | null
  lossless: boolean
  /** Measured purity 0–100, null until the background analyser reaches the file. */
  purity: number | null
  /** Highest frequency holding signal, kHz. */
  ceilingKhz: number | null
  /** Bits actually used by the samples. */
  effBits: number | null
  upscaled: boolean
  favorite: boolean
  rating: number
  playCount: number
  lastPlayed: number
  addedAt: number
  /** ReplayGain track gain in dB, when the file is tagged. */
  gainDb: number | null
  /** ReplayGain track peak (linear), when tagged. */
  peak: number | null
  /** Position inside a playlist (only for playlist scopes). */
  pos?: number
}

export interface Playlist {
  id: number
  name: string
  tracks: number
  minutes: number
  /** Artwork of the first track that has some, as a CSS background. */
  sleeve: string
  updatedAt: number
}

export interface HomeData {
  jumpBackIn: Album[]
  recentlyAdded: Album[]
  onRepeat: LibrarySong[]
  forgotten: LibrarySong[]
  review: { upscaled: number; measured: number; total: number; avgPurity: number | null }
}

export interface StatsData {
  songs: number
  albums: number
  artists: number
  hoursOfMusic: number
  plays: number
  hoursListened: number
  topArtists: Array<{ name: string; plays: number }>
  topSongs: Array<{ title: string; artist: string; plays: number; path: string }>
  topAlbums: Array<{ title: string; artist: string; plays: number }>
  byWeekday: number[]
  byHour: number[]
  purity: { pure: number; good: number; limited: number; thin: number; lossy: number; unmeasured: number }
  measured: number
  lossless: number
}

export interface AnalysisProgress { done: number; total: number }

export interface Lyrics { synced: boolean; lines: Array<{ t: number | null; text: string }>; source: 'sidecar' | 'embedded' }

export interface SongsPage {
  total: number
  rows: LibrarySong[]
}

/** "24/96 · verified" style label for a song (design C6). */
export function songQualityLabel(s: Pick<LibrarySong, 'quality' | 'sampleRate' | 'bitDepth' | 'codec' | 'offline'>): string {
  if (s.offline) return 'drive offline'
  const khz = s.sampleRate / 1000
  const rate = Number.isInteger(khz) ? String(khz) : khz.toFixed(1)
  switch (s.quality) {
    case 'lossy': return s.codec.toUpperCase()
    case 'upscaled': return `claims ${s.bitDepth ?? 24}/${rate} · upscaled`
    case 'hires': return `${s.bitDepth ?? 24}/${rate} · verified`
    case 'cd': return `${s.bitDepth ?? 16}/${rate} · full`
  }
}
