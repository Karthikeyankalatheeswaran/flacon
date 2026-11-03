import { join } from 'node:path'
import { BrowserWindow, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import { Channels } from '@shared/ipc'
import { PlaybackCommandSchema, type PlaybackCommand } from '@shared/playback'
import { lockDown } from './security'

let win: BrowserWindow | null = null
let decoder: UtilityProcess | null = null
let ready = false
const backlog: Array<PlaybackCommand | { type: 'resume-context' }> = []

// In a packaged app ffmpeg lives outside the asar; electron-builder unpacks it (milestone 8).
export function resolveFfmpeg(): string {
  const p = process.env['FLACON_FFMPEG'] ?? ffmpegPath ?? ''
  return p.replace('app.asar', 'app.asar.unpacked')
}

function spawnDecoder(): void {
  decoder = utilityProcess.fork(join(__dirname, 'decoder.js'), [], {
    serviceName: 'flacon-decoder',
    env: { ...process.env, FLACON_FFMPEG: resolveFfmpeg() } as Record<string, string>
  })
  // A crashed decoder must not take playback down for good: respawn and re-link the engine.
  decoder.on('exit', () => {
    decoder = null
    if (win && !win.isDestroyed()) setTimeout(link, 500)
  })
  link()
}

function link(): void {
  if (!win || win.isDestroyed()) return
  if (!decoder) return spawnDecoder()
  const { port1, port2 } = new MessageChannelMain()
  decoder.postMessage({ type: 'init' }, [port1])
  win.webContents.postMessage(Channels.decoderPort, null, [port2])
}

/** Hidden window that owns the AudioContext. Never throttled, lives for the whole session. */
export function isEngine(wcId: number): boolean {
  return !!win && !win.isDestroyed() && win.webContents.id === wcId
}

export function createEngineWindow(): BrowserWindow {
  win = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  lockDown(win)
  ready = false
  win.webContents.once('did-finish-load', () => {
    ready = true
    spawnDecoder()
    backlog.splice(0).forEach(sendToEngine) // commands that arrived while the engine was booting
  })
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) void win.loadURL(`${dev}/engine.html`)
  else void win.loadFile(join(__dirname, '../renderer/engine.html'))
  return win
}

export function sendToEngine(cmd: PlaybackCommand | { type: 'resume-context' }): void {
  if (!win || win.isDestroyed()) return
  if (!ready) {
    backlog.push(cmd)
    return
  }
  win.webContents.send(Channels.engineCommand, cmd)
}

/** Validate untrusted renderer input before it reaches the engine. */
export function dispatch(raw: unknown): void {
  const parsed = PlaybackCommandSchema.safeParse(raw)
  if (parsed.success) sendToEngine(parsed.data)
}

export function shutdownEngine(): void {
  decoder?.kill()
  decoder = null
  win?.destroy()
  win = null
}
