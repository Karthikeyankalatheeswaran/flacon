import type { UpdateStatus } from '@shared/update'
import type { AppSettings, AppSettingsInfo } from '@shared/ipc'
import type { FetchJob } from '@shared/fetch'
import { create } from 'zustand'
import type { AddPathsResult, AppState, PlayRequest, QueueSnapshot, ThemeSetting } from '@shared/ipc'
import type { MenuItem } from './lib/menu'
import type { AnalysisProgress, Album, LibraryProgress, Playlist } from '@shared/library'
import { initialPlayback, type PlaybackCommand, type PlaybackState } from '@shared/playback'
import { guardTint } from '@shared/tint'
import { bridge } from './lib/bridge'

export type Page = 'home' | 'library' | 'playlists' | 'list' | 'stats' | 'duplicates' | 'fetch' | 'settings'
export type Sheet = { kind: 'new-playlist'; paths: string[] } | { kind: 'rename-playlist'; id: number; name: string } | { kind: 'add-to-playlist'; paths: string[] }

interface UiState {
  app: AppState | null
  albums: Album[]
  libraryLoaded: boolean
  eqOpen: boolean
  page: Page
  /** Which list the "list" page shows: a smart id or "playlist:<id>". */
  scope: string
  setPage: (p: Page) => void
  openList: (scope: string) => void
  playlists: Playlist[]
  queue: QueueSnapshot
  activityVersion: number
  analysis: AnalysisProgress
  toast: string | null
  showToast: (msg: string) => void
  vesselTab: 'queue' | 'lyrics' | 'viz'
  reportOpen: boolean
  setReportOpen: (on: boolean) => void
  setVesselTab: (t: 'queue' | 'lyrics' | 'viz') => void
  sheet: Sheet | null
  setSheet: (s: Sheet | null) => void
  ctxMenu: { x: number; y: number; items: MenuItem[] } | null
  openMenu: (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void
  closeMenu: () => void
  play: (req: PlayRequest) => Promise<void>
  toggleFavorite: (path: string, value: boolean) => void
  settings: AppSettingsInfo | null
  update: UpdateStatus
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  fetchJobs: FetchJob[]
  setEqOpen: (open: boolean) => void
  /** Bumped whenever the library changes on disk; tables refetch when it moves. */
  libraryVersion: number
  search: string
  progress: LibraryProgress
  /** Real playback state from the audio engine (via main). */
  pb: PlaybackState
  setTheme: (t: ThemeSetting) => Promise<void>
  pour: (album: Album) => void
  send: (c: PlaybackCommand) => void
  openFiles: () => Promise<void>
  /** Native folder picker. */
  addFolder: () => Promise<void>
  /** Files/folders dropped on the window. */
  addDropped: (files: File[]) => Promise<void>
  playAlbum: (id: string) => Promise<void>
  setSearch: (q: string) => void
}

let toastTimer = 0

export const useStore = create<UiState>((set) => ({
  app: null,
  albums: [],
  libraryLoaded: false,
  eqOpen: false,
  page: 'home',
  scope: 'favorites',
  setPage: (page) => set({ page }),
  openList: (scope) => set({ page: 'list', scope }),
  playlists: [],
  queue: { rev: 0, items: [] },
  activityVersion: 0,
  analysis: { done: 0, total: 0 },
  toast: null,
  showToast: (toast) => {
    set({ toast })
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => set({ toast: null }), 4200)
  },
  vesselTab: 'queue',
  reportOpen: false,
  setReportOpen: (reportOpen) => set({ reportOpen }),
  setVesselTab: (vesselTab) => set({ vesselTab }),
  sheet: null,
  setSheet: (sheet) => set({ sheet }),
  ctxMenu: null,
  openMenu: (e, items) => {
    e.preventDefault()
    set({ ctxMenu: { x: e.clientX, y: e.clientY, items } })
  },
  closeMenu: () => set({ ctxMenu: null }),
  play: (req) => bridge.libraryPlay(req),
  toggleFavorite: (path, value) => void bridge.libraryCall({ op: 'setFavorite', path, value }),
  settings: null,
  update: { state: 'idle' },
  updateSettings: async (patch) => set({ settings: await bridge.setSettings(patch) }),
  fetchJobs: [],
  setEqOpen: (eqOpen) => set({ eqOpen }),
  libraryVersion: 0,
  search: '',
  progress: { phase: 'idle', done: 0, total: 0, denied: [] },
  pb: initialPlayback,
  setTheme: (t) => bridge.setTheme(t),
  pour: (album) => {
    void bridge.libraryPlay({ source: { kind: 'album', ids: [album.id] }, mode: 'last' })
    useStore.getState().showToast(`Added “${album.title}” to the queue`)
  },
  send: (c) => bridge.sendPlayback(c),
  openFiles: () => bridge.openFiles(),
  addFolder: async () => announceAdded(await bridge.libraryAddFolder()),
  addDropped: async (files) => announceAdded(await bridge.libraryAddDropped(files)),
  playAlbum: (id) => bridge.libraryPlayAlbum(id),
  setSearch: (q) => {
    set({ search: q })
    void refreshAlbums()
  }
}))

function announceAdded(r: AddPathsResult): void {
  const say = useStore.getState().showToast
  if (r.folders) say(`Added ${r.folders} folder${r.folders > 1 ? 's' : ''} — reading your music…`)
  else if (r.files) say(`Playing ${r.files} song${r.files > 1 ? 's' : ''}`)
  else if (r.ignored) say('Nothing to add — drop a music folder or audio files.')
}

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
  window.addEventListener('error', (e) => bridge.logError(`${e.message} @ ${(e.filename ?? '').split('/').pop()}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => bridge.logError(`unhandled rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`))
  const apply = (app: AppState): void => {
    document.documentElement.dataset['theme'] = app.resolvedTheme
    document.documentElement.dataset['platform'] = app.platform
    useStore.setState({ app })
  }
  void bridge.getState().then(apply)
  void bridge.getPlayback().then((pb) => useStore.setState({ pb }))
  void refreshAlbums()
  void bridge.getSettings().then((settings) => useStore.setState({ settings }))
  void bridge.getUpdate().then((update) => useStore.setState({ update }))
  const loadPlaylists = (): void => void bridge.libraryCall<Playlist[]>({ op: 'playlists' }).then((playlists) => useStore.setState({ playlists })).catch(() => undefined)
  loadPlaylists()
  void bridge.getQueue().then((queue) => useStore.setState({ queue }))
  const offQ = bridge.onQueue((queue) => useStore.setState({ queue }))
  const offS = bridge.onSettings((settings) => useStore.setState({ settings }))
  let actTimer = 0
  const offAct = bridge.onLibraryActivity(() => {
    // Favourites, plays, playlists and background purity results all land here; coalesce bursts.
    window.clearTimeout(actTimer)
    actTimer = window.setTimeout(() => {
      loadPlaylists()
      useStore.setState((s) => ({ activityVersion: s.activityVersion + 1 }))
    }, 250)
  })
  const offAn = bridge.onAnalysis((analysis) => useStore.setState({ analysis }))
  void bridge.libraryCall<AnalysisProgress>({ op: 'analysisProgress' }).then((analysis) => useStore.setState({ analysis })).catch(() => undefined)
  const offU = bridge.onUpdate((update) => useStore.setState({ update }))
  void bridge.fetchGet().then((fetchJobs) => useStore.setState({ fetchJobs }))
  const offF = bridge.onFetch((fetchJobs) => useStore.setState({ fetchJobs: [...fetchJobs] }))
  void bridge.getLibraryProgress().then((progress) => useStore.setState({ progress }))
  const offA = bridge.onState(apply)
  const offP = bridge.onPlayback((pb) => useStore.setState({ pb }))
  const offL = bridge.onLibraryProgress((progress) => useStore.setState({ progress }))
  let t = 0
  // Scans emit many "changed" events; refresh at most twice a second so the grid fills in smoothly.
  const offC = bridge.onLibraryChanged(() => {
    window.clearTimeout(t)
    t = window.setTimeout(() => {
      void refreshAlbums()
      useStore.setState((s) => ({ libraryVersion: s.libraryVersion + 1 }))
    }, 500)
  })
  return () => {
    offA()
    offP()
    offL()
    offC()
    offF()
    offU()
    offQ()
    offS()
    offAct()
    offAn()
  }
}
