import { create } from 'zustand'
import type { AppState, ThemeSetting } from '@shared/ipc'
import type { Album, LibraryProgress } from '@shared/library'
import { initialPlayback, type PlaybackCommand, type PlaybackState } from '@shared/playback'
import { guardTint } from '@shared/tint'
import { bridge } from './lib/bridge'

interface UiState {
  app: AppState | null
  albums: Album[]
  libraryLoaded: boolean
  search: string
  progress: LibraryProgress
  /** Queue held in the vessel (design: "pour an album"). Whole albums so search filters can't drop rows. */
  queue: Album[]
  /** Real playback state from the audio engine (via main). */
  pb: PlaybackState
  setTheme: (t: ThemeSetting) => Promise<void>
  pour: (album: Album) => void
  send: (c: PlaybackCommand) => void
  openFiles: () => Promise<void>
  addFolder: () => Promise<void>
  playAlbum: (id: string) => Promise<void>
  setSearch: (q: string) => void
}

export const useStore = create<UiState>((set) => ({
  app: null,
  albums: [],
  libraryLoaded: false,
  search: '',
  progress: { phase: 'idle', done: 0, total: 0, denied: [] },
  queue: [],
  pb: initialPlayback,
  setTheme: (t) => bridge.setTheme(t),
  pour: (album) => set((s) => (s.queue.some((a) => a.id === album.id) ? s : { queue: [...s.queue, album] })),
  send: (c) => bridge.sendPlayback(c),
  openFiles: () => bridge.openFiles(),
  addFolder: () => bridge.libraryAddFolder(),
  playAlbum: (id) => bridge.libraryPlayAlbum(id),
  setSearch: (q) => {
    set({ search: q })
    void refreshAlbums()
  }
}))

// Latest-wins: a slow earlier query must never overwrite a newer result.
let queryToken = 0
async function refreshAlbums(): Promise<void> {
  const token = ++queryToken
  const q = useStore.getState().search
  const albums = q.trim() ? await bridge.librarySearch(q) : await bridge.libraryAlbums()
  if (token === queryToken) useStore.setState({ albums, libraryLoaded: true })
}

/** Contrast-guarded tint for a record's colour (falls back to the foundations teal). */
export const guarded = (hex: string | undefined): string => guardTint(hex ?? '#13303A')

// Bridge state → store; applies the resolved theme to <html data-theme>.
export function initApp(): () => void {
  const apply = (app: AppState): void => {
    document.documentElement.dataset['theme'] = app.resolvedTheme
    document.documentElement.dataset['platform'] = app.platform
    useStore.setState({ app })
  }
  void bridge.getState().then(apply)
  void bridge.getPlayback().then((pb) => useStore.setState({ pb }))
  void refreshAlbums()
  void bridge.getLibraryProgress().then((progress) => useStore.setState({ progress }))
  const offA = bridge.onState(apply)
  const offP = bridge.onPlayback((pb) => useStore.setState({ pb }))
  const offL = bridge.onLibraryProgress((progress) => useStore.setState({ progress }))
  let t = 0
  // Scans emit many "changed" events; refresh at most twice a second so the grid fills in smoothly.
  const offC = bridge.onLibraryChanged(() => {
    window.clearTimeout(t)
    t = window.setTimeout(() => void refreshAlbums(), 500)
  })
  return () => {
    offA()
    offP()
    offL()
    offC()
  }
}
