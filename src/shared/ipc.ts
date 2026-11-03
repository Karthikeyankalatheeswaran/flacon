import { z } from 'zod'
import type { Album, LibraryProgress } from './library'
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

/** The only surface the preload bridge exposes to renderers. */
export interface FlaconBridge {
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
