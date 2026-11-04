import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { basename, dirname, extname, isAbsolute, resolve as resolvePath } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, Menu, nativeImage, nativeTheme, net, powerMonitor, powerSaveBlocker, protocol, screen, shell } from 'electron'
import { AppSettingsSchema, type AppSettings, type AppSettingsInfo } from '@shared/ipc'
import { displayKey, isVisibleOn, type WindowBounds } from '@shared/settings'
import { UpdateActionSchema } from '@shared/ipc'
import { checkForUpdate, downloadUpdate, installUpdate, startUpdater, stopUpdater, updateStatus } from './updater'
import { createSettingsStore, type SettingsStore } from './settingsStore'
import { AddPathsSchema, AlbumIdSchema, Channels, FolderDirSchema, PlayFolderSchema, PlayRequestSchema, RendererLibraryRequestSchema, SearchQuerySchema, SongsQuerySchema, ThemeSchema, type AddPathsResult, type AppState, type QueueItem, type QueueSnapshot, type ThemeSetting } from '@shared/ipc'
import type { AnalysisProgress, Album, LibraryProgress, LibrarySong, LibraryTrack, SongsPage } from '@shared/library'
import { defaultEq, sanitizeEq, type EqSettings } from '@shared/eq'
import { AUDIO_EXTENSIONS, initialPlayback, isAudioPath, type PlaybackState } from '@shared/playback'
import { cueRealPath } from '@shared/cue'
import { sanitizeShortcuts } from '@shared/shortcuts'
import { VIZ_BARS } from '@shared/spectrum'
import { safeToTrash, type DuplicateGroup } from '@shared/duplicates'
import { createEngineWindow, currentQueue, dispatch, setCueLookup, setGainLookup, setQueuePaths, isEngine, resolveFfmpeg, sendToEngine, shutdownEngine } from './engine'
import { forceMenu, refreshMenu, type MenuDeps } from './menu'
import { FetchControlSchema, FetchPickSchema, FetchSearchSchema, FetchSettingsSchema } from '@shared/fetchIpc'
import { z } from 'zod'
import { fetchControl, fetchEnqueue, fetchList, fetchSearch, getFetchSettings, setFetchSettings, startFetcher, stopFetcher } from './fetcher/service'
import type { FolderListing } from '@shared/folders'
import { artDir, call as libraryCall, getProgress, startLibrary, stopLibrary } from './library/client'
import { installCsp, isTrustedUrl } from './security'
import { fetchLyricsOnline } from './lyricsOnline'
import { logEvent, logFromRenderer, makeReport, reportAction, startDiagnostics } from './diagnostics'
import { createTray, updateTray } from './tray'
import { createIslandWindow, createMainWindow, createMiniWindow, MINI_SIZE, placeIsland } from './windows'
import { ISLAND_SPOTS, ISLAND_WINDOW, nearestSpot, type IslandSpot } from './islandPlacement'

// Unpackaged runs would otherwise be called "Electron" in the menu bar and Dock.
if (!app.isPackaged) app.setName('Flacon')
startDiagnostics()

// Local artwork is served only through this scheme, from the art cache dir, by hashed filename.
protocol.registerSchemesAsPrivileged([{ scheme: 'flacon-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let theme: ThemeSetting = 'system'
let mainWin: BrowserWindow | null = null
let playback: PlaybackState = { ...initialPlayback }
let blockerId: number | null = null
let settings: SettingsStore
let islandWin: BrowserWindow | null = null
let miniWin: BrowserWindow | null = null
let volumeRestored = false
let wasPlayingBeforeSuspend = false
let nowMeta: LibrarySong | null = null
let nowMetaPath = ''
let queueRev = 0
let queueSnapshot: QueueSnapshot = { rev: 0, items: [] }
// Listening history: a play counts once the track has really been heard for 30 s or half its length.
const listen = { path: '', lastPos: 0, acc: 0, counted: false }

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

/** Unpackaged runs have no bundled icon: give the Dock the app icon so dev builds don't show Electron's. */
function applyDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin') return
  const img = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  if (!img.isEmpty()) app.dock?.setIcon(img)
}

function makeMainWindow(hidden: boolean): BrowserWindow {
  const saved = restoredBounds()
  const win = createMainWindow({ bounds: saved, hidden })
  // macOS can fall back to the default icon when a window is minimised or comes back: set it again each time.
  win.on('minimize', applyDockIcon)
  win.on('restore', applyDockIcon)
  win.on('show', applyDockIcon)
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
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] })
}

function settingsInfo(): AppSettingsInfo {
  const s = settings.get()
  return {
    launchAtLogin: s.launchAtLogin, pauseOnSuspend: s.pauseOnSuspend, updateChecks: s.updateChecks, islandEdge: s.islandEdge, islandAlign: s.islandAlign, outputDevice: s.outputDevice, onboarded: s.onboarded,
    islandEnabled: s.islandEnabled, islandMode: s.islandMode, islandSize: s.islandSize, islandArt: s.islandArt, islandBadge: s.islandBadge, islandStyle: s.islandStyle, replayGain: s.replayGain, crossfade: s.crossfade, showLyrics: s.showLyrics, lyricsOnline: s.lyricsOnline, shortcuts: s.shortcuts,
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
  quit: () => app.quit(),
  islandSpots: () => positionItems()
}

/** Show the main window, then tell the UI what to do (the native menu's job). */
function ui(action: string): void {
  trayDeps.showMain()
  const send = (): void => mainWin?.webContents.send(Channels.menuAction, action)
  if (mainWin?.webContents.isLoading()) mainWin.webContents.once('did-finish-load', send)
  else send()
}

const islandSpot = (): IslandSpot => ({ edge: settings.get().islandEdge, align: settings.get().islandAlign })
const SPOT_LABEL: Record<string, string> = { 'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right' }

/** Radio items for the six island spots (tray menu and the island's own right-click menu). */
function positionItems(): Electron.MenuItemConstructorOptions[] {
  const cur = islandSpot()
  return ISLAND_SPOTS.map((s) => ({
    label: SPOT_LABEL[`${s.edge}-${s.align}`]!,
    type: 'radio' as const,
    checked: s.edge === cur.edge && s.align === cur.align,
    click: () => setIslandSpot(s)
  }))
}

function setIslandSpot(s: IslandSpot): void {
  applySettings({ islandEdge: s.edge, islandAlign: s.align })
}

let dragTimer: NodeJS.Timeout | null = null
function endIslandDrag(snap: boolean): void {
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = null
  if (!islandWin || islandWin.isDestroyed()) return
  const p = screen.getCursorScreenPoint()
  if (snap) setIslandSpot(nearestSpot(screen.getDisplayNearestPoint(p), p))
  else placeIsland(islandWin, islandSpot())
}

/** Open or close the mini player; its last position is restored if that spot is still on a screen. */
function toggleMini(): void {
  if (miniWin && !miniWin.isDestroyed()) { miniWin.close(); return }
  const saved = settings.get().miniPos
  const onScreen = saved && screen.getAllDisplays().some((d) => saved.x >= d.bounds.x && saved.y >= d.bounds.y && saved.x + MINI_SIZE.width <= d.bounds.x + d.bounds.width && saved.y + MINI_SIZE.height <= d.bounds.y + d.bounds.height)
  const win = createMiniWindow(onScreen ? saved : null)
  miniWin = win
  let t: NodeJS.Timeout | undefined
  win.on('move', () => {
    clearTimeout(t)
    t = setTimeout(() => { if (!win.isDestroyed()) { const [x, y] = win.getPosition(); settings.set({ miniPos: { x: x!, y: y! } }) } }, 400)
  })
  win.on('closed', () => { clearTimeout(t); if (miniWin === win) miniWin = null; forceMenu(menuDeps) })
  forceMenu(menuDeps)
}

/** Create or destroy the floating island to match the setting. */
function syncIsland(): void {
  const on = settings.get().islandEnabled
  if (on && (!islandWin || islandWin.isDestroyed())) islandWin = createIslandWindow(islandSpot)
  else if (!on && islandWin && !islandWin.isDestroyed()) {
    islandWin.destroy()
    islandWin = null
  }
}

async function playlistIo(req: { op: 'import' } | { op: 'export'; id: number }): Promise<{ ok: boolean; message: string }> {
  const win = mainWin && !mainWin.isDestroyed() ? mainWin : undefined
  if (req.op === 'import') {
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { ok: false, message: '' }
    const file = r.filePaths[0]
    const stat = await fsp.stat(file)
    if (stat.size > 8 * 1024 * 1024) return { ok: false, message: 'That playlist file is too large.' }
    const lines = (await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    const paths = lines.slice(0, 5000).map((l) => (l.startsWith('file://') ? decodeURIComponent(new URL(l).pathname) : isAbsolute(l) ? l : resolvePath(dirname(file), l)))
    const res = await libraryCall<{ id: number; matched: number; total: number }>({ op: 'playlistImport', name: basename(file, extname(file)), paths })
    return { ok: res.matched > 0, message: res.matched ? `Imported ${res.matched} of ${res.total} songs.` : 'None of those songs are in your library.' }
  }
  const lists = await libraryCall<Array<{ id: number; name: string }>>({ op: 'playlists' })
  const pl = lists.find((l) => l.id === req.id)
  if (!pl) return { ok: false, message: 'That playlist no longer exists.' }
  const opts = { defaultPath: `${pl.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`, filters: [{ name: 'Playlist', extensions: ['m3u8'] }] }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return { ok: false, message: '' }
  const paths = await libraryCall<string[]>({ op: 'playlistPaths', id: req.id })
  const metas = new Map((await libraryCall<LibrarySong[]>({ op: 'trackMetas', paths })).map((m) => [m.path, m]))
  const body = paths.map((p) => { const m = metas.get(p); return `#EXTINF:${Math.round(m?.durationSec ?? 0)},${m ? `${m.artist} - ${m.title}` : basename(p)}\n${cueRealPath(p)}` })
  await fsp.writeFile(r.filePath, `#EXTM3U\n${body.join('\n')}\n`, 'utf8')
  return { ok: true, message: `Saved ${paths.length} songs.` }
}

const menuDeps: MenuDeps = {
  send: (c) => dispatch(c),
  ui,
  addFolder: () => ui('add-folder'),
  openFiles: () => void (async () => {
    const opts = { properties: ['openFile' as const, 'multiSelections' as const], filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }] }
    const r = mainWin && !mainWin.isDestroyed() ? await dialog.showOpenDialog(mainWin, opts) : await dialog.showOpenDialog(opts)
    if (!r.canceled) openPaths(r.filePaths)
  })(),
  importPlaylist: () => void playlistIo({ op: 'import' }).then((r) => r.message && ui(`toast:${r.message}`)),
  checkForUpdates: () => { checkForUpdate(); ui('go:settings') },
  setTheme: (t) => { theme = t; settings.set({ theme: t }); nativeTheme.themeSource = t; broadcast(); forceMenu(menuDeps) },
  toggleMini,
  miniOn: () => !!miniWin && !miniWin.isDestroyed(),
  toggleIsland: () => { settings.set({ islandEnabled: !settings.get().islandEnabled }); syncIsland(); const info = settingsInfo(); for (const w of uiWindows()) w.webContents.send(Channels.settingsChanged, info); forceMenu(menuDeps) },
  playback: () => playback,
  theme: () => theme,
  islandOn: () => settings.get().islandEnabled,
  lyricsOn: () => settings.get().showLyrics,
  shortcuts: () => settings.get().shortcuts
}

function withMeta(s: PlaybackState): PlaybackState {
  return { ...s, meta: s.track && nowMeta?.path === s.track.path ? nowMeta : null }
}

function emitPlayback(): void {
  const s = withMeta(playback)
  for (const w of uiWindows()) w.webContents.send(Channels.playbackState, s)
}

/** Library facts (artwork, purity, favourite) for the playing track. */
function loadNowMeta(path: string): void {
  void libraryCall<LibrarySong[]>({ op: 'trackMetas', paths: [path] })
    .then((rows) => {
      if (nowMetaPath !== path) return
      nowMeta = rows[0] ?? null
      emitPlayback()
    })
    .catch(() => undefined)
}

function trackListening(s: PlaybackState): void {
  const t = s.track
  if (!t) return
  if (t.path !== listen.path) Object.assign(listen, { path: t.path, lastPos: s.positionSec, acc: 0, counted: false })
  const d = s.positionSec - listen.lastPos
  if (d < -5) Object.assign(listen, { acc: 0, counted: false }) // restarted (repeat-one, seek to start)
  else if (s.status === 'playing' && d > 0 && d < 2) listen.acc += d
  listen.lastPos = s.positionSec
  if (!listen.counted && listen.acc >= Math.min(30, Math.max(5, t.durationSec / 2))) {
    listen.counted = true
    void libraryCall({ op: 'recordPlay', path: t.path, secs: listen.acc }).catch(() => undefined)
  }
}

let lastEngineError: string | null = null
function onEngineState(s: PlaybackState): void {
  playback = s
  if (s.error && s.error !== lastEngineError) logEvent('warn', `playback: ${s.error}`)
  lastEngineError = s.error
  persistEq(s.eq)
  // The engine boots at the default volume before our saved one is applied: don't let that echo overwrite it.
  if (!volumeRestored) volumeRestored = Math.abs(s.volume - settings.get().volume) < 0.005
  else if (s.volume !== settings.get().volume) settings.set({ volume: s.volume })
  if (s.shuffle !== settings.get().shuffle || s.repeat !== settings.get().repeat) settings.set({ shuffle: s.shuffle, repeat: s.repeat })
  // Diagnostics for smoke tests / bug reports; no effect unless the env var is set.
  if (process.env['FLACON_LOG_STATE']) console.log('[state]', JSON.stringify({ st: s.status, i: s.queueIndex, n: s.queueLength, pos: +s.positionSec.toFixed(2), t: s.track?.title, sr: s.track?.sampleRate, bd: s.track?.bitDepth, rate: s.outputRate, toast: s.toast, vol: s.volume, eq: s.eq.enabled ? s.eq.preset + ' ' + s.eq.preamp : 'off', sh: s.shuffle, rp: s.repeat }))
  const path = s.track?.path ?? ''
  if (path !== nowMetaPath) {
    nowMetaPath = path
    nowMeta = null
    if (path) loadNowMeta(path)
  }
  trackListening(s)
  emitPlayback()
  updateTray(s, trayDeps, mainWin)
  refreshMenu(menuDeps)
  // Keep the machine awake (but the display free to sleep) only while audio is playing.
  if (s.status === 'playing' && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
  else if (s.status !== 'playing' && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

const slim = (r: LibrarySong | undefined, path: string): QueueItem => ({
  path, title: r?.title ?? basename(path, extname(path)), artist: r?.artist ?? '', album: r?.album ?? '', durationSec: r?.durationSec ?? 0,
  artUrl: r?.artUrl ?? null, purity: r?.purity ?? null, lossless: r?.lossless ?? true, favorite: r?.favorite ?? false, upscaled: r?.upscaled ?? false
})

/** The engine reports its queue (play order); main attaches library facts and fans it out to the windows. */
async function onEngineQueue(paths: string[]): Promise<void> {
  setQueuePaths(paths)
  const rev = ++queueRev
  let rows: LibrarySong[] = []
  try {
    rows = paths.length ? await libraryCall<LibrarySong[]>({ op: 'trackMetas', paths: [...new Set(paths)] }) : []
  } catch {
    /* library not ready: show file names */
  }
  if (rev !== queueRev) return // a newer queue arrived while we were looking this one up
  const byPath = new Map(rows.map((r) => [r.path, r]))
  queueSnapshot = { rev, items: paths.map((p) => slim(byPath.get(p), p)) }
  for (const w of uiWindows()) w.webContents.send(Channels.queue, queueSnapshot)
}

/** Play files handed to us by the OS (double-click, "Open with", second instance). */
function openPaths(paths: string[]): void {
  const tracks = paths.filter(isAudioPath).map((path) => ({ path }))
  if (tracks.length) dispatch({ type: 'load', tracks, index: 0 })
}

/** Picked or dropped paths: folders join the library (then scan), audio files play, anything else is ignored. */
async function addPaths(paths: string[]): Promise<AddPathsResult> {
  const out: AddPathsResult = { folders: 0, files: 0, ignored: 0 }
  const files: string[] = []
  for (const p of new Set(paths)) {
    const st = isAbsolute(p) ? await fsp.stat(p).catch(() => null) : null // renderer-supplied: never trust relative paths
    if (st?.isDirectory()) {
      await libraryCall({ op: 'addFolder', path: p })
      out.folders++
    } else if (st?.isFile() && isAudioPath(p)) files.push(p)
    else out.ignored++
  }
  if (out.folders) await libraryCall({ op: 'scan' })
  if (files.length) {
    openPaths(files)
    out.files = files.length
  }
  return out
}

/** Apply a validated settings patch everywhere it matters, then tell every window. */
function applySettings(patch: Partial<AppSettings>): AppSettingsInfo {
  if (patch.shortcuts !== undefined) patch = { ...patch, shortcuts: sanitizeShortcuts(patch.shortcuts) } // never trust the renderer's key map
  settings.set(patch)
  if (patch.launchAtLogin !== undefined) applyLoginItem(patch.launchAtLogin)
  if ((patch.islandEdge !== undefined || patch.islandAlign !== undefined) && islandWin && !islandWin.isDestroyed()) placeIsland(islandWin, islandSpot())
  if (patch.islandEnabled !== undefined) syncIsland()
  if (patch.replayGain !== undefined) dispatch({ type: 'replayGain', mode: patch.replayGain })
  if (patch.crossfade !== undefined) dispatch({ type: 'crossfade', seconds: patch.crossfade })
  if (patch.outputDevice !== undefined) dispatch({ type: 'output', deviceId: '', label: patch.outputDevice })
  const info = settingsInfo()
  for (const w of uiWindows()) w.webContents.send(Channels.settingsChanged, info)
  forceMenu(menuDeps)
  if (patch.islandEdge !== undefined || patch.islandAlign !== undefined) updateTray(playback, trayDeps, mainWin) // refresh the radio ticks
  return info
}

/** Every IPC handler goes through these: a message from anything but one of our own pages is dropped. */
const rendererDirUrl = (): string => pathToFileURL(join(__dirname, '../renderer')).toString()
function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const ok = !!e.senderFrame && e.senderFrame === e.sender.mainFrame && isTrustedUrl(e.senderFrame.url, rendererDirUrl(), process.env['ELECTRON_RENDERER_URL'])
  if (!ok) logEvent('warn', `ipc: refused a message from ${e.senderFrame?.url ?? 'an unknown frame'}`)
  return ok
}
const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void => // eslint-disable-line @typescript-eslint/no-explicit-any
  ipcMain.handle(channel, (e, ...args) => { if (!trusted(e)) throw new Error('Untrusted sender'); return fn(e, ...args) })
const on = (channel: string, fn: (e: IpcMainEvent, ...args: any[]) => void): void => // eslint-disable-line @typescript-eslint/no-explicit-any
  void ipcMain.on(channel, (e, ...args) => { if (trusted(e)) fn(e, ...args) })

function registerIpc(): void {
  handle(Channels.getState, () => snapshot())
  handle(Channels.setTheme, (_e, raw: unknown) => {
    const next = ThemeSchema.parse(raw) // reject anything unexpected from a renderer
    theme = next
    settings.set({ theme: next })
    nativeTheme.themeSource = next
    broadcast()
  })
  on(Channels.island, (e, raw: unknown) => {
    // Only the island window's own contents may toggle its click-through.
    const win = BrowserWindow.fromWebContents(e.sender)
    if (typeof raw !== 'boolean' || !win) return
    win.setIgnoreMouseEvents(!raw, { forward: true })
  })
  on(Channels.showMain, (e) => {
    if (islandWin && !islandWin.isDestroyed() && e.sender === islandWin.webContents) trayDeps.showMain()
  })
  handle(Channels.getPlayback, () => playback)
  on(Channels.playbackCommand, (_e, raw: unknown) => dispatch(raw))
  handle(Channels.openFiles, async () => {
    const opts = {
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }]
    }
    const r = mainWin && !mainWin.isDestroyed() ? await dialog.showOpenDialog(mainWin, opts) : await dialog.showOpenDialog(opts)
    if (!r.canceled) openPaths(r.filePaths)
  })
  // Only the hidden engine window may publish playback state.
  on(Channels.engineState, (e, s: PlaybackState) => {
    if (isEngine(e.sender.id)) onEngineState(s)
  })
  handle(Channels.libraryAlbums, () => libraryCall<Album[]>({ op: 'albums' }))
  handle(Channels.librarySearch, (_e, raw: unknown) => {
    const q = SearchQuerySchema.parse(raw)
    return q.trim() ? libraryCall<Album[]>({ op: 'search', query: q }) : libraryCall<Album[]>({ op: 'albums' })
  })
  handle(Channels.librarySongs, (_e, raw: unknown) => libraryCall<SongsPage>({ op: 'songs', query: SongsQuerySchema.parse(raw) }))
  handle(Channels.libraryGetProgress, () => getProgress())
  handle(Channels.libraryAddFolder, async (): Promise<AddPathsResult> => {
    const opts = { title: 'Choose your music folder', properties: ['openDirectory', 'multiSelections'] as Array<'openDirectory' | 'multiSelections'> }
    const r = mainWin && !mainWin.isDestroyed() ? await dialog.showOpenDialog(mainWin, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return { folders: 0, files: 0, ignored: 0 }
    return addPaths(r.filePaths)
  })
  handle(Channels.libraryAddPaths, (_e, raw: unknown) => addPaths(AddPathsSchema.parse(raw)))
  handle(Channels.libraryFolders, () => libraryCall<string[]>({ op: 'folders' }))
  handle(Channels.libraryRemoveFolder, async (_e, raw: unknown) => {
    const path = z.string().min(1).max(4096).parse(raw)
    // Only folders that are actually in the library can be removed: the renderer can't name arbitrary paths.
    if (!(await libraryCall<string[]>({ op: 'folders' })).includes(path)) return
    await libraryCall({ op: 'removeFolder', path })
  })
  handle(Channels.updateGet, () => updateStatus())
  on(Channels.updateAction, (_e, raw: unknown) => {
    const op = UpdateActionSchema.safeParse(raw)
    if (!op.success) return
    if (op.data === 'check') checkForUpdate()
    else if (op.data === 'download') downloadUpdate()
    else installUpdate()
  })
  handle(Channels.settingsGet, () => settingsInfo())
  handle(Channels.settingsSet, (_e, raw: unknown) => applySettings(AppSettingsSchema.partial().parse(raw) as Partial<AppSettings>))
  // Island: drag to reposition (main follows the cursor; the pill snaps to the nearest spot on drop) and its right-click menu.
  on(Channels.islandDrag, (e, raw: unknown) => {
    if (!islandWin || islandWin.isDestroyed() || e.sender !== islandWin.webContents) return
    if (raw === 'start') {
      if (dragTimer) clearInterval(dragTimer)
      const started = Date.now()
      dragTimer = setInterval(() => {
        if (!islandWin || islandWin.isDestroyed() || Date.now() - started > 30_000) return endIslandDrag(false)
        const p = screen.getCursorScreenPoint()
        islandWin.setPosition(Math.round(p.x - ISLAND_WINDOW.width / 2), Math.round(p.y - 30))
      }, 16)
    } else if (raw === 'end') endIslandDrag(true)
  })
  on(Channels.islandMenu, (e) => {
    if (!islandWin || islandWin.isDestroyed() || e.sender !== islandWin.webContents) return
    Menu.buildFromTemplate([
      { label: 'Position', submenu: positionItems() },
      { label: 'Hide island', click: () => void applySettings({ islandEnabled: false }) },
      { type: 'separator' },
      { label: 'Open Flacon', click: trayDeps.showMain }
    ]).popup({ window: islandWin })
  })
  setCueLookup((paths) => libraryCall({ op: 'cueRefs', paths }))
  setGainLookup((paths) => libraryCall<LibrarySong[]>({ op: 'trackMetas', paths }).then((r) => r.map((x) => ({ path: x.path, gainDb: x.gainDb, peak: x.peak }))))
  handle(Channels.libraryFolder, (_e, raw: unknown) => libraryCall<FolderListing>({ op: 'folder', dir: FolderDirSchema.parse(raw) }))
  handle(Channels.libraryPlayFolder, async (_e, raw: unknown) => {
    const { dir, index } = PlayFolderSchema.parse(raw)
    const listing = await libraryCall<FolderListing>({ op: 'folder', dir })
    if (listing.tracks.length) dispatch({ type: 'load', tracks: listing.tracks.map((t) => ({ path: t.path })), index: Math.min(index, listing.tracks.length - 1) })
  })
  handle(Channels.libraryPlayAlbum, async (_e, raw: unknown) => {
    const albumId = Number(AlbumIdSchema.parse(raw))
    const tracks = await libraryCall<LibraryTrack[]>({ op: 'albumTracks', albumId })
    if (tracks.length) dispatch({ type: 'load', tracks: tracks.map((t) => ({ path: t.path })), index: 0 })
  })
  handle(Channels.fetchSearch, (_e, raw: unknown) => {
    const q = FetchSearchSchema.parse(raw)
    return fetchSearch(q.provider, q.query, q.quality)
  })
  handle(Channels.fetchEnqueue, (_e, raw: unknown) => {
    const p = FetchPickSchema.parse(raw)
    return fetchEnqueue(p.provider, p.id, p.quality)
  })
  on(Channels.fetchControl, (_e, raw: unknown) => {
    const c = FetchControlSchema.safeParse(raw)
    if (c.success) fetchControl(c.data.op, c.data.id)
  })
  handle(Channels.fetchGet, () => fetchList())
  handle(Channels.fetchSettingsGet, () => getFetchSettings())
  handle(Channels.fetchSettingsSet, (_e, raw: unknown) => setFetchSettings(FetchSettingsSchema.parse(raw)))
  handle(Channels.libraryCall, async (_e, raw: unknown) => {
    const req = RendererLibraryRequestSchema.parse(raw) // only the allow-listed operations reach the worker
    if (req.op === 'lyricsOnline') return fetchLyricsOnline(req.path, settings.get().lyricsOnline)
    return libraryCall(req)
  })
  const resolveSource = (src: z.infer<typeof PlayRequestSchema>['source']): Promise<string[]> => {
    switch (src.kind) {
      case 'scope': return libraryCall<string[]>({ op: 'scopePaths', scope: src.scope, text: src.text, limit: 5000 })
      case 'album': return libraryCall<string[]>({ op: 'albumPaths', albumIds: src.ids.map(Number) })
      case 'artist': return libraryCall<string[]>({ op: 'artistPaths', artist: src.name })
      case 'paths': return Promise.resolve(src.paths.filter(isAudioPath))
    }
  }
  handle(Channels.libraryPlay, async (_e, raw: unknown) => {
    const r = PlayRequestSchema.parse(raw)
    const paths = await resolveSource(r.source)
    if (!paths.length) return
    const tracks = paths.map((path) => ({ path }))
    if (r.mode === 'play') dispatch({ type: 'load', tracks, index: Math.min(r.index ?? 0, tracks.length - 1) })
    else if (r.mode === 'shuffle') {
      dispatch({ type: 'shuffle', on: true })
      dispatch({ type: 'load', tracks, index: Math.floor(Math.random() * tracks.length) })
    } else dispatch({ type: 'enqueue', tracks, mode: r.mode })
  })
  handle(Channels.getQueue, () => queueSnapshot)
  on(Channels.engineQueue, (e, raw: unknown) => {
    if (!isEngine(e.sender.id)) return
    const paths = (raw as { paths?: unknown })?.paths
    if (Array.isArray(paths) && paths.every((p) => typeof p === 'string')) void onEngineQueue(paths as string[])
  })
  on(Channels.reveal, (_e, raw: unknown) => {
    // Only files that are in the library can be revealed: the renderer can't point Finder at arbitrary paths.
    const path = z.string().min(1).max(4096).safeParse(raw)
    if (!path.success) return
    void libraryCall<LibrarySong[]>({ op: 'trackMetas', paths: [path.data] }).then((r) => r[0] && shell.showItemInFolder(cueRealPath(r[0].path)))
  })
  // Visualizer: the engine only runs its analyser while at least one window is watching.
  const vizWatchers = new Set<number>()
  const vizSync = (): void => dispatch({ type: 'viz', on: vizWatchers.size > 0 })
  on(Channels.vizSub, (e, raw: unknown) => {
    if (isEngine(e.sender.id) || typeof raw !== 'boolean') return
    const id = e.sender.id
    const before = vizWatchers.size
    if (raw) {
      vizWatchers.add(id)
      e.sender.once('destroyed', () => { vizWatchers.delete(id); vizSync() })
    } else vizWatchers.delete(id)
    if ((before === 0) !== (vizWatchers.size === 0)) vizSync()
  })
  on(Channels.engineViz, (e, bars: unknown) => {
    if (!isEngine(e.sender.id) || !(bars instanceof Uint8Array) || bars.length !== VIZ_BARS) return
    for (const w of uiWindows()) if (vizWatchers.has(w.webContents.id)) w.webContents.send(Channels.viz, bars)
  })
  on(Channels.logRenderer, (e, raw: unknown) => {
    if (isEngine(e.sender.id) || typeof raw !== 'string') return
    logFromRenderer(raw.slice(0, 1500))
  })
  handle(Channels.report, async (e, raw: unknown) => {
    if (isEngine(e.sender.id)) return { ok: false, message: 'Not allowed.', text: '' }
    const req = z.object({ op: z.enum(['get', 'copy', 'save']), note: z.string().max(4000) }).parse(raw)
    const s = settings.get()
    // Only plain facts about how the app is set up: never paths, device names or the Jamendo ID.
    const text = makeReport(req.note, { theme, replayGain: s.replayGain, crossfade: s.crossfade, outputDevice: s.outputDevice ? 'custom' : 'system default', islandEnabled: s.islandEnabled, islandMode: s.islandMode, lyricsOnline: s.lyricsOnline, showLyrics: s.showLyrics, updateChecks: s.updateChecks, launchAtLogin: s.launchAtLogin, customShortcuts: Object.keys(s.shortcuts).length })
    const r = await reportAction(req.op, text, BrowserWindow.fromWebContents(e.sender) ?? undefined)
    return { ...r, text }
  })
  on(Channels.mini, (e, raw: unknown) => {
    if (!miniWin || miniWin.isDestroyed() || e.sender !== miniWin.webContents) return // only the mini window controls itself
    const op = z.enum(['close', 'expand', 'pin', 'unpin']).safeParse(raw)
    if (!op.success) return
    if (op.data === 'close') miniWin.close()
    else if (op.data === 'expand') trayDeps.showMain()
    else miniWin.setAlwaysOnTop(op.data === 'pin', 'floating')
  })
  handle(Channels.trashDuplicates, async (e, raw: unknown) => {
    if (isEngine(e.sender.id)) return { trashed: 0, message: 'Not allowed.' }
    const requested = z.array(z.string().min(1).max(4096)).max(2000).parse(raw)
    // Never trust the renderer's list: re-derive the duplicate groups here and only allow files inside them,
    // always leaving one copy of every song.
    const groups = await libraryCall<DuplicateGroup[]>({ op: 'duplicates' })
    const allowed = safeToTrash(groups, requested)
    if (allowed.length === 0) return { trashed: 0, message: 'Nothing to move.' }
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { type: 'warning' as const, buttons: ['Move to Trash', 'Cancel'], defaultId: 1, cancelId: 1, message: `Move ${allowed.length} ${allowed.length === 1 ? 'file' : 'files'} to the Trash?`, detail: 'One copy of every song stays in your library. You can restore these from the Trash.' }
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (response !== 0) return { trashed: 0, message: 'Cancelled.' }
    let trashed = 0
    for (const p of allowed) {
      try { await shell.trashItem(p); trashed++ } catch { /* already gone or not allowed: skip */ }
    }
    void libraryCall({ op: 'scan' })
    return { trashed, message: trashed === allowed.length ? `Moved ${trashed} to the Trash.` : `Moved ${trashed} of ${allowed.length}; the rest could not be moved.` }
  })
  handle(Channels.playlistIo, (_e, raw: unknown) => playlistIo(z.discriminatedUnion('op', [z.object({ op: z.literal('import') }), z.object({ op: z.literal('export'), id: z.number().int().min(1) })]).parse(raw)))
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
  void startLibrary({ ffmpeg: resolveFfmpeg().path,
    activity: () => { send(Channels.libraryActivity, null); if (nowMetaPath) loadNowMeta(nowMetaPath) },
    analysis: (p: AnalysisProgress) => send(Channels.libraryAnalysis, p),
    progress: (p: LibraryProgress) => send(Channels.libraryProgress, p), changed: () => {
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
    applyDockIcon()
    app.on('browser-window-focus', applyDockIcon)
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
    dispatch({ type: 'shuffle', on: settings.get().shuffle })
    dispatch({ type: 'repeat', mode: settings.get().repeat })
    dispatch({ type: 'replayGain', mode: settings.get().replayGain })
    dispatch({ type: 'crossfade', seconds: settings.get().crossfade })
    if (settings.get().outputDevice) dispatch({ type: 'output', deviceId: '', label: settings.get().outputDevice })
    restoreSession()
    mainWin = makeMainWindow(launchedHidden())
    startUpdater((st) => uiWindows().forEach((w) => w.webContents.send(Channels.updateState, st)), () => settings.get().updateChecks)
    syncIsland()
    forceMenu(menuDeps)
    setInterval(saveSession, 15_000).unref() // survive a crash with a recent position
    createTray(playback, trayDeps)
    if (process.env['FLACON_LOG_STATE']) console.log('[argv]', JSON.stringify(process.argv))
    openPaths(process.argv.slice(app.isPackaged ? 1 : 2))
  })
}
