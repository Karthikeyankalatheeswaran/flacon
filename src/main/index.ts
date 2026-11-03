import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, powerSaveBlocker } from 'electron'
import { Channels, ThemeSchema, type AppState, type ThemeSetting } from '@shared/ipc'
import { AUDIO_EXTENSIONS, initialPlayback, isAudioPath, type PlaybackState } from '@shared/playback'
import { createEngineWindow, dispatch, isEngine, sendToEngine, shutdownEngine } from './engine'
import { installCsp } from './security'
import { createTray, updateTray } from './tray'
import { createIslandWindow, createMainWindow } from './windows'

let theme: ThemeSetting = 'system'
let mainWin: BrowserWindow | null = null
let playback: PlaybackState = { ...initialPlayback }
let blockerId: number | null = null
const pauseOnSuspend = true // becomes a setting in milestone 7
let wasPlayingBeforeSuspend = false

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
  // Diagnostics for smoke tests / bug reports; no effect unless the env var is set.
  if (process.env['FLACON_LOG_STATE']) console.log('[state]', JSON.stringify({ st: s.status, i: s.queueIndex, n: s.queueLength, pos: +s.positionSec.toFixed(2), t: s.track?.title, sr: s.track?.sampleRate, bd: s.track?.bitDepth, rate: s.outputRate, toast: s.toast }))
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
  nativeTheme.on('updated', broadcast)
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
  app.on('will-quit', shutdownEngine)
  // window-all-closed deliberately does not quit: the island and the audio engine live on.
  app.on('window-all-closed', () => {})
  app.on('activate', () => trayDeps.showMain())

  void app.whenReady().then(() => {
    installCsp()
    registerIpc()
    registerPower()
    createEngineWindow()
    mainWin = createMainWindow()
    createIslandWindow()
    createTray(playback, trayDeps)
    if (process.env['FLACON_LOG_STATE']) console.log('[argv]', JSON.stringify(process.argv))
    openPaths(process.argv.slice(app.isPackaged ? 1 : 2))
  })
}
