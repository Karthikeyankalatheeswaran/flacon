import { z } from 'zod'
import type { FetchBridge } from './fetchIpc'
import type { UpdateStatus } from './update'
import { SONG_SORTS, type Album, type LibraryProgress, type SongsPage, type SongsQuery } from './library'
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
  onboarded: z.boolean()
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
  onState(cb: (s: AppState) => void): () => void
  getPlayback(): Promise<PlaybackState>
  sendPlayback(cmd: PlaybackCommand): void
  /** Native file picker; main validates extensions and starts playback. */
  openFiles(): Promise<void>
  onPlayback(cb: (s: PlaybackState) => void): () => void
  libraryAlbums(): Promise<Album[]>
  librarySearch(query: string): Promise<Album[]>
  /** Native folder picker; main persists the folder and scans it. */
  libraryAddFolder(): Promise<void>
  libraryPlayAlbum(albumId: string): Promise<void>
  libraryFolders(): Promise<string[]>
  libraryRemoveFolder(path: string): Promise<void>
  getUpdate(): Promise<UpdateStatus>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  updateAction(op: 'check' | 'download' | 'install'): void
  getSettings(): Promise<AppSettingsInfo>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettingsInfo>
  librarySongs(q: SongsQuery): Promise<SongsPage>
  getLibraryProgress(): Promise<LibraryProgress>
  onLibraryProgress(cb: (p: LibraryProgress) => void): () => void
  onLibraryChanged(cb: () => void): () => void
}

export const SearchQuerySchema = z.string().max(200)
export const AlbumIdSchema = z.string().regex(/^\d{1,12}$/)

/** Engine window's own minimal surface (separate preload). */
export interface EngineBridge {
  onCommand(cb: (c: PlaybackCommand | { type: 'resume-context' }) => void): () => void
  emitState(s: PlaybackState): void
}

export const SongsQuerySchema = z.object({
  sort: z.enum(SONG_SORTS),
  dir: z.enum(['asc', 'desc']),
  text: z.string().max(200),
  offset: z.number().int().min(0).max(10_000_000),
  limit: z.number().int().min(1).max(500)
})

export const UpdateActionSchema = z.enum(['check', 'download', 'install'])
