import { z } from 'zod'
import type { FetchBridge } from './fetchIpc'
import type { UpdateStatus } from './update'
import { SONG_SORTS, type AnalysisProgress, type Album, type LibraryProgress, type LibrarySong, type SongsPage, type SongsQuery } from './library'
import { SCOPE_RE } from './smart'
import type { FolderListing } from './folders'
import type { PlaybackCommand, PlaybackState } from './playback'

// Every IPC payload crosses a trust boundary: main validates with these schemas before acting.

export { Channels } from './channels'

export const ThemeSchema = z.enum(['system', 'light', 'dark'])
export type ThemeSetting = z.infer<typeof ThemeSchema>

/** Island visual states. Hover intent and collapse rules live in shared/islandMachine.ts. */
export const IslandStateSchema = z.enum(['hidden', 'dot', 'compact', 'hover', 'expanded', 'activity', 'error'])
export type IslandStateName = z.infer<typeof IslandStateSchema>

export const IslandEventSchema = z.object({
  type: z.enum(['pointer-enter', 'pointer-leave', 'click', 'escape', 'blur', 'activity', 'error', 'dismiss', 'hide', 'show'])
})
export type IslandEventMsg = z.infer<typeof IslandEventSchema>

export const AppStateSchema = z.object({
  theme: ThemeSchema,
  resolvedTheme: z.enum(['light', 'dark']),
  platform: z.enum(['darwin', 'win32', 'linux'])
})
export type AppState = z.infer<typeof AppStateSchema>

export const AppSettingsSchema = z.object({
  launchAtLogin: z.boolean(),
  pauseOnSuspend: z.boolean(),
  updateChecks: z.boolean(),
  islandEdge: z.enum(['top', 'bottom']),
  islandAlign: z.enum(['left', 'center', 'right']),
  outputDevice: z.string().max(256),
  onboarded: z.boolean(),
  islandEnabled: z.boolean(),
  /** When the island shows: always, only while something is loaded, or never idle. */
  islandMode: z.enum(['always', 'playing']),
  islandSize: z.enum(['compact', 'comfortable']),
  islandArt: z.boolean(),
  islandBadge: z.boolean(),
  islandStyle: z.enum(['water', 'ink', 'record', 'paper', 'aurora']),
  replayGain: z.enum(['off', 'track']),
  crossfade: z.number().int().min(0).max(10),
  showLyrics: z.boolean(),
  lyricsOnline: z.boolean(),
  shortcuts: z.record(z.string().max(40), z.string().max(40))
})
export type AppSettings = z.infer<typeof AppSettingsSchema>
/** What the settings page needs beyond the editable values. */
export interface AppSettingsInfo extends AppSettings {
  /** The settings file was damaged at startup and has been reset (a backup was kept). */
  recovered: boolean
  /** Login items are only registered for packaged builds. */
  canLaunchAtLogin: boolean
  platform: AppState['platform']
}

/** The only surface the preload bridge exposes to renderers. */
export interface FlaconBridge extends FetchBridge {
  getState(): Promise<AppState>
  setTheme(theme: ThemeSetting): Promise<void>
  /** Island window: toggles click-through so the transparent area never eats clicks. */
  setIslandInteractive(interactive: boolean): void
  /** Island: the pill is being dragged (main follows the cursor and snaps to the nearest spot on drop). */
  islandDrag(phase: 'start' | 'end'): void
  /** Island: right-click menu (Position ›, Hide island, Open Flacon), shown natively by main. */
  islandMenu(): void
  /** Island: bring the main window forward. */
  showMain(): void
  onState(cb: (s: AppState) => void): () => void
  getPlayback(): Promise<PlaybackState>
  sendPlayback(cmd: PlaybackCommand): void
  /** Native file picker; main validates extensions and starts playback. */
  openFiles(): Promise<void>
  onPlayback(cb: (s: PlaybackState) => void): () => void
  libraryAlbums(): Promise<Album[]>
  librarySearch(query: string): Promise<Album[]>
  /** Native folder picker; main persists the folder and scans it. */
  libraryAddFolder(): Promise<AddPathsResult>
  /** Files or folders dropped onto the window: folders join the library, audio files start playing. */
  libraryAddDropped(files: File[]): Promise<AddPathsResult>
  libraryPlayAlbum(albumId: string): Promise<void>
  libraryFolders(): Promise<string[]>
  libraryRemoveFolder(path: string): Promise<void>
  getUpdate(): Promise<UpdateStatus>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  updateAction(op: 'check' | 'download' | 'install'): void
  getSettings(): Promise<AppSettingsInfo>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettingsInfo>
  onSettings(cb: (s: AppSettingsInfo) => void): () => void
  librarySongs(q: SongsQuery): Promise<SongsPage>
  libraryFolder(dir: string | null): Promise<FolderListing>
  /** Queue the tracks directly in `dir` and start at `index`. */
  libraryPlayFolder(dir: string, index: number): Promise<void>
  getLibraryProgress(): Promise<LibraryProgress>
  onLibraryProgress(cb: (p: LibraryProgress) => void): () => void
  onLibraryChanged(cb: () => void): () => void
  /** Validated, allow-listed library operations (favourites, playlists, home, stats, lyrics…). */
  libraryCall<T = unknown>(req: RendererLibraryRequest): Promise<T>
  /** Resolve a list/album/artist/path source in main and play, shuffle or enqueue it. */
  libraryPlay(req: PlayRequest): Promise<void>
  getQueue(): Promise<QueueSnapshot>
  onQueue(cb: (q: QueueSnapshot) => void): () => void
  /** Favourite/rating/plays/playlist changes and background purity measurements. */
  onLibraryActivity(cb: () => void): () => void
  onAnalysis(cb: (p: AnalysisProgress) => void): () => void
  /** Native app-menu clicks that the UI must act on ("go:settings", "new-playlist"…). */
  onMenuAction(cb: (action: string) => void): () => void
  /** Native file dialogs for playlist import (M3U/M3U8) and export. */
  playlistIo(req: { op: 'import' } | { op: 'export'; id: number }): Promise<{ ok: boolean; message: string }>
  /** Spectrum bars for the visualizer: subscribe while it is on screen (main only runs the analyser while somebody listens). */
  vizSubscribe(on: boolean): void
  onViz(cb: (bars: Uint8Array) => void): () => void
  /** "Report a problem": build the redacted report text, copy it, or save it to a file. Nothing is sent anywhere. */
  report(req: { op: 'get' | 'copy' | 'save'; note: string }): Promise<{ ok: boolean; message: string; text: string }>
  /** Renderer errors go to the local log. */
  logError(message: string): void
  /** Mini player window controls (only the mini window itself may use these). */
  mini(op: 'close' | 'expand' | 'pin' | 'unpin'): void
  /** Show a file in Finder / Explorer. */
  reveal(path: string): void
  /** Ask to move extra copies of duplicate songs to the Trash (main re-checks and confirms natively). */
  trashDuplicates(paths: string[]): Promise<{ trashed: number; message: string }>
}

/** What the queue panel shows: slim rows, play order. */
export type QueueItem = Pick<LibrarySong, 'path' | 'title' | 'artist' | 'album' | 'durationSec' | 'artUrl' | 'purity' | 'lossless' | 'favorite' | 'upscaled'>
export interface QueueSnapshot { rev: number; items: QueueItem[] }

const Paths = z.array(z.string().min(1).max(4096)).max(5000)
const Id = z.number().int().min(1).max(2_000_000_000)
export const RendererLibraryRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setFavorite'), path: z.string().min(1).max(4096), value: z.boolean() }),
  z.object({ op: z.literal('setRating'), path: z.string().min(1).max(4096), value: z.number().int().min(0).max(5) }),
  z.object({ op: z.literal('playlists') }),
  z.object({ op: z.literal('playlistCreate'), name: z.string().max(120), paths: Paths }),
  z.object({ op: z.literal('playlistRename'), id: Id, name: z.string().max(120) }),
  z.object({ op: z.literal('playlistDelete'), id: Id }),
  z.object({ op: z.literal('playlistAdd'), id: Id, paths: Paths }),
  z.object({ op: z.literal('playlistRemove'), id: Id, positions: z.array(z.number().int().min(0).max(100_000)).max(5000) }),
  z.object({ op: z.literal('playlistMove'), id: Id, from: z.number().int().min(0).max(100_000), to: z.number().int().min(0).max(100_000) }),
  z.object({ op: z.literal('lyrics'), path: z.string().min(1).max(4096) }),
  z.object({ op: z.literal('lyricsOnline'), path: z.string().min(1).max(4096) }),
  z.object({ op: z.literal('home') }),
  z.object({ op: z.literal('stats') }),
  z.object({ op: z.literal('analysisProgress') }),
  z.object({ op: z.literal('duplicates') }),
  z.object({ op: z.literal('trackMetas'), paths: Paths })
])
export type RendererLibraryRequest = z.infer<typeof RendererLibraryRequestSchema>

export const PlayRequestSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('scope'), scope: z.string().regex(SCOPE_RE), text: z.string().max(200).default('') }),
    z.object({ kind: z.literal('album'), ids: z.array(z.string().regex(/^\d{1,12}$/)).min(1).max(100) }),
    z.object({ kind: z.literal('artist'), name: z.string().min(1).max(512) }),
    z.object({ kind: z.literal('paths'), paths: Paths.min(1) })
  ]),
  mode: z.enum(['play', 'shuffle', 'next', 'last']),
  /** For "play": start at this row of the source. */
  index: z.number().int().min(0).max(1_000_000).optional()
})
export type PlayRequest = z.infer<typeof PlayRequestSchema>

/** What happened to a batch of picked or dropped paths. */
export interface AddPathsResult { folders: number; files: number; ignored: number }
export const AddPathsSchema = z.array(z.string().min(1).max(4096)).min(1).max(500)

export const SearchQuerySchema = z.string().max(200)
export const FolderDirSchema = z.string().min(1).max(4096).nullable()
export const PlayFolderSchema = z.object({ dir: z.string().min(1).max(4096), index: z.number().int().min(0).max(1_000_000) })
export const AlbumIdSchema = z.string().regex(/^\d{1,12}$/)

/** Engine window's own minimal surface (separate preload). */
export interface EngineBridge {
  onCommand(cb: (c: PlaybackCommand | { type: 'resume-context' }) => void): () => void
  emitState(s: PlaybackState): void
  /** Queue contents (play order) whenever they change. */
  emitQueue(paths: string[], index: number): void
  /** Spectrum bars (VIZ_BARS bytes) while the visualizer is on. */
  emitViz(bars: Uint8Array): void
}

export const SongsQuerySchema = z.object({
  sort: z.enum(SONG_SORTS),
  dir: z.enum(['asc', 'desc']),
  text: z.string().max(200),
  scope: z.string().regex(SCOPE_RE).optional(),
  offset: z.number().int().min(0).max(10_000_000),
  limit: z.number().int().min(1).max(500)
})

export const UpdateActionSchema = z.enum(['check', 'download', 'install'])
