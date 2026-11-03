import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, powerMonitor, powerSaveBlocker, protocol } from 'electron'
import { AlbumIdSchema, Channels, SearchQuerySchema, SongsQuerySchema, ThemeSchema, type AppState, type ThemeSetting } from '@shared/ipc'
import type { Album, LibraryProgress, LibraryTrack, SongsPage } from '@shared/library'
import { defaultEq, sanitizeEq, type EqSettings } from '@shared/eq'
import { AUDIO_EXTENSIONS, initialPlayback, isAudioPath, type PlaybackState } from '@shared/playback'
import { createEngineWindow, dispatch, isEngine, resolveFfmpeg, sendToEngine, shutdownEngine } from './engine'
import { FetchControlSchema, FetchPickSchema, FetchSearchSchema, FetchSettingsSchema } from '@shared/fetchIpc'
import { fetchControl, fetchEnqueue, fetchList, fetchSearch, getFetchSettings, setFetchSettings, startFetcher, stopFetcher } from './fetcher/service'
import { artDir, call as libraryCall, getProgress, startLibrary, stopLibrary } from './library/client'
import { installCsp } from './security'
import { createTray, updateTray } from './tray'
import { createIslandWindow, createMainWindow } from './windows'

// Local artwork is served only through this scheme, from the art cache dir, by hashed filename.
protocol.registerSchemesAsPrivileged([{ scheme: 'flacon-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let theme: ThemeSetting = 'system'
let mainWin: BrowserWindow | null = null
let playback: PlaybackState = { ...initialPlayback }
let blockerId: number | null = null
const pauseOnSuspend = true // becomes a setting in milestone 7
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
    if (!mainWin || mainWin.isDestroyed()) mainWin = createMainWindow()
    mainWin.show()
    mainWin.focus()
  },
  quit: () => app.quit()
}

function onEngineState(s: PlaybackState): void {
  playback = s
  persistEq(s.eq)
  // Diagnostics for smoke tests / bug reports; no effect unless the env var is set.
  if (process.env['FLACON_LOG_STATE']) console.log('[state]', JSON.stringify({ st: s.status, i: s.queueIndex, n: s.queueLength, pos: +s.positionSec.toFixed(2), t: s.track?.title, sr: s.track?.sampleRate, bd: s.track?.bitDepth, rate: s.outputRate, toast: s.toast, eq: s.eq.enabled ? s.eq.preset + ' ' + s.eq.preamp : 'off' }))
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
    ffmpeg: resolveFfmpeg(),
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
    if (pauseOnSuspend && wasPlayingBeforeSuspend) dispatch({ type: 'pause' })
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
    stopFetcher()
    shutdownEngine()
    stopLibrary()
  })
  // window-all-closed deliberately does not quit: the island and the audio engine live on.
  app.on('window-all-closed', () => {})
  app.on('activate', () => trayDeps.showMain())

  void app.whenReady().then(() => {
    installCsp()
    registerIpc()
    registerPower()
    startLibraryService()
    startFetchService()
    createEngineWindow()
    const eq = loadEq()
    savedEq = JSON.stringify(eq) // don't rewrite what we just read
    dispatch({ type: 'eq', eq }) // the engine queues it until its worklet has loaded
    mainWin = createMainWindow()
    createIslandWindow()
    createTray(playback, trayDeps)
    if (process.env['FLACON_LOG_STATE']) console.log('[argv]', JSON.stringify(process.argv))
    openPaths(process.argv.slice(app.isPackaged ? 1 : 2))
  })
}
