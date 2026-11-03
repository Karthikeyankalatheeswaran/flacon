import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, powerMonitor, powerSaveBlocker, protocol, screen } from 'electron'
import { AppSettingsSchema, type AppSettings, type AppSettingsInfo } from '@shared/ipc'
import { displayKey, isVisibleOn, type WindowBounds } from '@shared/settings'
import { UpdateActionSchema } from '@shared/ipc'
import { checkForUpdate, downloadUpdate, installUpdate, startUpdater, stopUpdater, updateStatus } from './updater'
import { createSettingsStore, type SettingsStore } from './settingsStore'
import { AlbumIdSchema, Channels, FolderDirSchema, PlayFolderSchema, SearchQuerySchema, SongsQuerySchema, ThemeSchema, type AppState, type ThemeSetting } from '@shared/ipc'
import type { Album, LibraryProgress, LibraryTrack, SongsPage } from '@shared/library'
import { defaultEq, sanitizeEq, type EqSettings } from '@shared/eq'
import { AUDIO_EXTENSIONS, initialPlayback, isAudioPath, type PlaybackState } from '@shared/playback'
import { cueRealPath } from '@shared/cue'
import { createEngineWindow, currentQueue, dispatch, setCueLookup, isEngine, resolveFfmpeg, sendToEngine, shutdownEngine } from './engine'
import { FetchControlSchema, FetchPickSchema, FetchSearchSchema, FetchSettingsSchema } from '@shared/fetchIpc'
import { z } from 'zod'
import { fetchControl, fetchEnqueue, fetchList, fetchSearch, getFetchSettings, setFetchSettings, startFetcher, stopFetcher } from './fetcher/service'
import type { FolderListing } from '@shared/folders'
import { artDir, call as libraryCall, getProgress, startLibrary, stopLibrary } from './library/client'
import { installCsp } from './security'
import { createTray, updateTray } from './tray'
import { createIslandWindow, createMainWindow, placeIsland } from './windows'

// Local artwork is served only through this scheme, from the art cache dir, by hashed filename.
protocol.registerSchemesAsPrivileged([{ scheme: 'flacon-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let theme: ThemeSetting = 'system'
let mainWin: BrowserWindow | null = null
let playback: PlaybackState = { ...initialPlayback }
let blockerId: number | null = null
let settings: SettingsStore
let islandWin: BrowserWindow | null = null
let volumeRestored = false
let wasPlayingBeforeSuspend = false

// EQ settings persist as a tiny JSON file; anything malformed falls back to flat (never blocks startup).
const eqFile = (): string => join(app.getPath('userData'), 'eq.json')
function loadEq(): EqSettings {
  try {
    return sanitizeEq(JSON.parse(readFileSync(eqFile(), 'utf8')))
  } catch {
    return defaultEq
  }
}
let savedEq = ''
let eqTimer: NodeJS.Timeout | undefined
function persistEq(eq: EqSettings): void {
  const json = JSON.stringify(eq)
  if (json === savedEq) return
  savedEq = json
  clearTimeout(eqTimer)
  eqTimer = setTimeout(() => {
    try {
      writeFileSync(eqFile(), json)
    } catch {
      /* read-only profile: the EQ just won't persist */
    }
  }, 400) // debounce slider drags
}

const launchedHidden = (): boolean => process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin

/** Bounds saved for the display the window would open on, but only if they are still on a connected screen. */
function restoredBounds(): WindowBounds | undefined {
  const d = screen.getPrimaryDisplay()
  const saved = settings.get().windows[displayKey(d)]
  if (!saved || !isVisibleOn(saved, screen.getAllDisplays().map((x) => x.workArea))) return undefined
  return saved
}

function makeMainWindow(hidden: boolean): BrowserWindow {
  const saved = restoredBounds()
  const win = createMainWindow({ bounds: saved, hidden })
  if (saved?.maximized) win.once('ready-to-show', () => win.maximize())
  let t: NodeJS.Timeout | undefined
  const remember = (): void => {
    clearTimeout(t)
    t = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
      const b = win.getNormalBounds()
      settings.set({ windows: { ...settings.get().windows, [displayKey(screen.getDisplayMatching(b))]: { ...b, maximized: win.isMaximized() } } })
    }, 400)
  }
  win.on('resize', remember)
  win.on('move', remember)
  return win
}

function applyLoginItem(enabled: boolean): void {
  // Registering the dev binary (electron.app) as a login item would be wrong: packaged builds only.
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: enabled ? ['--hidden'] : [] })
}

function settingsInfo(): AppSettingsInfo {
  const s = settings.get()
  return {
    launchAtLogin: s.launchAtLogin, pauseOnSuspend: s.pauseOnSuspend, updateChecks: s.updateChecks, islandEdge: s.islandEdge, onboarded: s.onboarded,
    recovered: settings.recoveredFrom !== null, canLaunchAtLogin: app.isPackaged, platform: process.platform as AppState['platform']
  }
}

/** Queue + position at quit, restored paused so launching never blasts audio. */
function saveSession(): void {
  const paths = currentQueue()
  if (!paths.length || !playback.track) return
  settings.set({ session: { paths, index: playback.queueIndex, positionSec: Math.floor(playback.positionSec) } })
}

function restoreSession(): void {
  const s = settings.get().session
  if (!s || !s.paths.length) return
  const paths = s.paths.filter((p) => existsSync(cueRealPath(p))) // files on a drive that isn't mounted are simply skipped
  if (!paths.length) return
  const lostBefore = s.paths.slice(0, s.index).filter((p) => !existsSync(cueRealPath(p))).length
  dispatch({ type: 'load', tracks: paths.map((path) => ({ path })), index: Math.max(0, Math.min(paths.length - 1, s.index - lostBefore)), paused: true, startSec: s.positionSec })
}

function snapshot(): AppState {
  return {
    theme,
    resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    platform: process.platform as AppState['platform']
  }
}

function uiWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !isEngine(w.webContents.id))
}

function broadcast(): void {
  for (const w of uiWindows()) w.webContents.send(Channels.state, snapshot())
}

const trayDeps = {
  send: (c: Parameters<typeof dispatch>[0]) => dispatch(c),
  showMain: () => {
    if (!mainWin || mainWin.isDestroyed()) mainWin = makeMainWindow(false)
    mainWin.show()
    mainWin.focus()
  },
  quit: () => app.quit()
}

function onEngineState(s: PlaybackState): void {
  playback = s
  persistEq(s.eq)
  // The engine boots at the default volume before our saved one is applied: don't let that echo overwrite it.
  if (!volumeRestored) volumeRestored = Math.abs(s.volume - settings.get().volume) < 0.005
  else if (s.volume !== settings.get().volume) settings.set({ volume: s.volume })
  // Diagnostics for smoke tests / bug reports; no effect unless the env var is set.
  if (process.env['FLACON_LOG_STATE']) console.log('[state]', JSON.stringify({ st: s.status, i: s.queueIndex, n: s.queueLength, pos: +s.positionSec.toFixed(2), t: s.track?.title, sr: s.track?.sampleRate, bd: s.track?.bitDepth, rate: s.outputRate, toast: s.toast, vol: s.volume, eq: s.eq.enabled ? s.eq.preset + ' ' + s.eq.preamp : 'off' }))
  for (const w of uiWindows()) w.webContents.send(Channels.playbackState, s)
  updateTray(s, trayDeps, mainWin)
  // Keep the machine awake (but the display free to sleep) only while audio is playing.
  if (s.status === 'playing' && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
  else if (s.status !== 'playing' && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

/** Play files handed to us by the OS (double-click, "Open with", second instance). */
function openPaths(paths: string[]): void {
  const tracks = paths.filter(isAudioPath).map((path) => ({ path }))
  if (tracks.length) dispatch({ type: 'load', tracks, index: 0 })
}

function registerIpc(): void {
  ipcMain.handle(Channels.getState, () => snapshot())
  ipcMain.handle(Channels.setTheme, (_e, raw: unknown) => {
    const next = ThemeSchema.parse(raw) // reject anything unexpected from a renderer
    theme = next
    settings.set({ theme: next })
    nativeTheme.themeSource = next
    broadcast()
  })
  ipcMain.on(Channels.island, (e, raw: unknown) => {
    // Only the island window's own contents may toggle its click-through.
    const win = BrowserWindow.fromWebContents(e.sender)
    if (typeof raw !== 'boolean' || !win) return
    win.setIgnoreMouseEvents(!raw, { forward: true })
  })
  ipcMain.handle(Channels.getPlayback, () => playback)
  ipcMain.on(Channels.playbackCommand, (_e, raw: unknown) => dispatch(raw))
  ipcMain.handle(Channels.openFiles, async () => {
    const opts = {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }]
    }
    const r = mainWin && !mainWin.isDestroyed() ? await dialog.showOpenDialog(mainWin, opts) : await dialog.showOpenDialog(opts)
    if (!r.canceled) openPaths(r.filePaths)
  })
  // Only the hidden engine window may publish playback state.
  ipcMain.on(Channels.engineState, (e, s: PlaybackState) => {
    if (isEngine(e.sender.id)) onEngineState(s)
  })
  ipcMain.handle(Channels.libraryAlbums, () => libraryCall<Album[]>({ op: 'albums' }))
  ipcMain.handle(Channels.librarySearch, (_e, raw: unknown) => {
    const q = SearchQuerySchema.parse(raw)
    return q.trim() ? libraryCall<Album[]>({ op: 'search', query: q }) : libraryCall<Album[]>({ op: 'albums' })
  })
  ipcMain.handle(Channels.librarySongs, (_e, raw: unknown) => libraryCall<SongsPage>({ op: 'songs', query: SongsQuerySchema.parse(raw) }))
  ipcMain.handle(Channels.libraryGetProgress, () => getProgress())
  ipcMain.handle(Channels.libraryAddFolder, async () => {
    const opts = { properties: ['openDirectory', 'multiSelections'] as Array<'openDirectory' | 'multiSelections'> }
    const r = mainWin && !mainWin.isDestroyed() ? await dialog.showOpenDialog(mainWin, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return
    for (const path of r.filePaths) await libraryCall({ op: 'addFolder', path })
    await libraryCall({ op: 'scan' })
  })
  ipcMain.handle(Channels.libraryFolders, () => libraryCall<string[]>({ op: 'folders' }))
  ipcMain.handle(Channels.libraryRemoveFolder, async (_e, raw: unknown) => {
    const path = z.string().min(1).max(4096).parse(raw)
    // Only folders that are actually in the library can be removed: the renderer can't name arbitrary paths.
    if (!(await libraryCall<string[]>({ op: 'folders' })).includes(path)) return
    await libraryCall({ op: 'removeFolder', path })
  })
  ipcMain.handle(Channels.updateGet, () => updateStatus())
  ipcMain.on(Channels.updateAction, (_e, raw: unknown) => {
    const op = UpdateActionSchema.safeParse(raw)
    if (!op.success) return
    if (op.data === 'check') checkForUpdate()
    else if (op.data === 'download') downloadUpdate()
    else installUpdate()
  })
  ipcMain.handle(Channels.settingsGet, () => settingsInfo())
  ipcMain.handle(Channels.settingsSet, (_e, raw: unknown) => {
    const patch = AppSettingsSchema.partial().parse(raw) as Partial<AppSettings>
    settings.set(patch)
    if (patch.launchAtLogin !== undefined) applyLoginItem(patch.launchAtLogin)
    if (patch.islandEdge !== undefined && islandWin && !islandWin.isDestroyed()) placeIsland(islandWin, patch.islandEdge)
    return settingsInfo()
  })
  setCueLookup((paths) => libraryCall({ op: 'cueRefs', paths }))
  ipcMain.handle(Channels.libraryFolder, (_e, raw: unknown) => libraryCall<FolderListing>({ op: 'folder', dir: FolderDirSchema.parse(raw) }))
  ipcMain.handle(Channels.libraryPlayFolder, async (_e, raw: unknown) => {
    const { dir, index } = PlayFolderSchema.parse(raw)
    const listing = await libraryCall<FolderListing>({ op: 'folder', dir })
    if (listing.tracks.length) dispatch({ type: 'load', tracks: listing.tracks.map((t) => ({ path: t.path })), index: Math.min(index, listing.tracks.length - 1) })
  })
  ipcMain.handle(Channels.libraryPlayAlbum, async (_e, raw: unknown) => {
    const albumId = Number(AlbumIdSchema.parse(raw))
    const tracks = await libraryCall<LibraryTrack[]>({ op: 'albumTracks', albumId })
    if (tracks.length) dispatch({ type: 'load', tracks: tracks.map((t) => ({ path: t.path })), index: 0 })
  })
  ipcMain.handle(Channels.fetchSearch, (_e, raw: unknown) => {
    const q = FetchSearchSchema.parse(raw)
    return fetchSearch(q.provider, q.query)
  })
  ipcMain.handle(Channels.fetchEnqueue, (_e, raw: unknown) => {
    const p = FetchPickSchema.parse(raw)
    return fetchEnqueue(p.provider, p.id)
  })
  ipcMain.on(Channels.fetchControl, (_e, raw: unknown) => {
    const c = FetchControlSchema.safeParse(raw)
    if (c.success) fetchControl(c.data.op, c.data.id)
  })
  ipcMain.handle(Channels.fetchGet, () => fetchList())
  ipcMain.handle(Channels.fetchSettingsGet, () => getFetchSettings())
  ipcMain.handle(Channels.fetchSettingsSet, (_e, raw: unknown) => setFetchSettings(FetchSettingsSchema.parse(raw)))
  nativeTheme.on('updated', broadcast)
}

function startFetchService(): void {
  void startFetcher({
    ffmpeg: resolveFfmpeg().path,
    onJobs: (jobs) => uiWindows().forEach((w) => w.webContents.send(Channels.fetchState, jobs)),
    onImported: (root) => {
      // The managed folder is added once; the watcher indexes new files, and an explicit scan covers the first import.
      void libraryCall({ op: 'addFolder', path: root }).then(() => libraryCall({ op: 'scan' }))
    }
  })
}

function startLibraryService(): void {
  protocol.handle('flacon-art', (req) => {
    const name = new URL(req.url).pathname.split('/').pop() ?? ''
    if (!/^[a-f0-9]{40}\.(jpg|png|webp|gif)$/.test(name)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(join(artDir(), name)).toString())
  })
  const send = (ch: string, v: unknown): void => uiWindows().forEach((w) => w.webContents.send(ch, v))
  void startLibrary({ progress: (p: LibraryProgress) => send(Channels.libraryProgress, p), changed: () => {
      send(Channels.libraryChanged, null)
      if (process.env['FLACON_LOG_STATE']) void libraryCall<Album[]>({ op: 'albums' }).then((a) => console.log('[library]', JSON.stringify(a.map((x) => ({ t: x.title, a: x.artist, q: x.quality, n: x.trackCount, min: x.minutes, art: /flacon-art/.test(x.sleeve), off: x.offline })))))
    } })
    .then((r) => {
      if (r.recoveredFrom) console.warn('[library] database was corrupt; moved to', r.recoveredFrom) // user-facing notice arrives with settings UI
      return libraryCall<string[]>({ op: 'folders' })
    })
    .then(async (f) => {
      // Dev/smoke-test hook: seed a library folder without the native picker.
      const seed = process.env['FLACON_LIBRARY_FOLDER']
      if (seed && !f.includes(seed)) {
        await libraryCall({ op: 'addFolder', path: seed })
        f = [...f, seed]
      }
      return f.length ? libraryCall({ op: 'scan' }) : undefined // incremental rescan on launch
    })
    .catch((e: Error) => console.error('[library]', e.message))
}

function registerPower(): void {
  powerMonitor.on('suspend', () => {
    wasPlayingBeforeSuspend = playback.status === 'playing'
    if (settings.get().pauseOnSuspend && wasPlayingBeforeSuspend) dispatch({ type: 'pause' })
  })
  const recover = (): void => sendToEngine({ type: 'resume-context' }) // recover the AudioContext
  powerMonitor.on('resume', recover)
  powerMonitor.on('unlock-screen', recover)
}

// A second launch focuses the existing instance and handles any file arguments.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    trayDeps.showMain()
    openPaths(argv.slice(1))
  })
  app.on('open-file', (e, path) => {
    e.preventDefault() // macOS: double-click an audio file
    openPaths([path])
  })
  app.on('before-quit', () => {
    ;(globalThis as { __flaconQuitting?: boolean }).__flaconQuitting = true
    dispatch({ type: 'pause' }) // fade out via the worklet; queue persistence arrives with settings (milestone 7)
  })
  app.on('will-quit', () => {
    saveSession()
    settings.flush()
    stopUpdater()
    stopFetcher()
    shutdownEngine()
    stopLibrary()
  })
  // window-all-closed deliberately does not quit: the island and the audio engine live on.
  app.on('window-all-closed', () => {})
  app.on('activate', () => trayDeps.showMain())

  void app.whenReady().then(() => {
    installCsp()
    settings = createSettingsStore(join(app.getPath('userData'), 'settings.json'))
    theme = settings.get().theme
    nativeTheme.themeSource = theme
    registerIpc()
    registerPower()
    startLibraryService()
    startFetchService()
    createEngineWindow()
    const eq = loadEq()
    savedEq = JSON.stringify(eq) // don't rewrite what we just read
    dispatch({ type: 'eq', eq }) // the engine queues it until its worklet has loaded
    dispatch({ type: 'volume', slider: settings.get().volume })
    restoreSession()
    mainWin = makeMainWindow(launchedHidden())
    startUpdater((st) => uiWindows().forEach((w) => w.webContents.send(Channels.updateState, st)), () => settings.get().updateChecks)
    islandWin = createIslandWindow(() => settings.get().islandEdge)
    setInterval(saveSession, 15_000).unref() // survive a crash with a recent position
    createTray(playback, trayDeps)
    if (process.env['FLACON_LOG_STATE']) console.log('[argv]', JSON.stringify(process.argv))
    openPaths(process.argv.slice(app.isPackaged ? 1 : 2))
  })
}
