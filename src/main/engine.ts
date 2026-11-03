import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app, BrowserWindow, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron'
import { Channels } from '@shared/ipc'
import { cueRealPath, isCuePath } from '@shared/cue'
import { PlaybackCommandSchema, type PlaybackCommand, type TrackRef } from '@shared/playback'
import { lockDown } from './security'

let win: BrowserWindow | null = null
let decoder: UtilityProcess | null = null
let ready = false
const backlog: Array<PlaybackCommand | { type: 'resume-context' }> = []

/** GPL ffmpeg-static is a dev-only fallback and is excluded from packaged builds, so it must be loaded lazily and may be absent. */
function devFfmpeg(): string {
  try {
    return (createRequire(join(app.getAppPath(), 'package.json'))('ffmpeg-static') as string | null) ?? ''
  } catch {
    return ''
  }
}

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

/**
 * Order: explicit override, the bundled LGPL+soxr build (Resources/ffmpeg when packaged, vendor/ffmpeg when it
 * has been built for this platform), then the GPL ffmpeg-static dev fallback (never shipped; see check:ffmpeg).
 */
export function resolveFfmpeg(): { path: string; soxr: boolean } {
  const override = process.env['FLACON_FFMPEG']
  if (override) return { path: override, soxr: process.env['FLACON_SOXR'] === '1' }
  const bundled = app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg', exe)
    : join(__dirname, '..', '..', 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe)
  if (existsSync(bundled)) return { path: bundled, soxr: true }
  return { path: devFfmpeg(), soxr: false }
}

function spawnDecoder(): void {
  const ff = resolveFfmpeg()
  decoder = utilityProcess.fork(join(__dirname, 'decoder.js'), [], {
    serviceName: 'flacon-decoder',
    env: { ...process.env, FLACON_FFMPEG: ff.path, FLACON_SOXR: ff.soxr ? '1' : '0' } as Record<string, string>
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
let lastQueue: string[] = []
/** Paths of the most recently loaded queue (saved with the session at quit). */
export const currentQueue = (): string[] => lastQueue

/** Looks up start/end/title for CUE virtual paths (the library DB owns them). */
type CueLookup = (paths: string[]) => Promise<Array<{ path: string; title: string; startSec: number; endSec: number }>>
let cueLookup: CueLookup | null = null
export const setCueLookup = (f: CueLookup): void => { cueLookup = f }

async function resolveCues(tracks: TrackRef[]): Promise<TrackRef[]> {
  const wanted = tracks.filter((t) => !t.cue && isCuePath(t.path)).map((t) => t.path)
  if (!wanted.length || !cueLookup) return tracks
  const found = new Map((await cueLookup(wanted)).map((r) => [r.path, r]))
  // A virtual path with no row (sheet deleted since) can't be played as a slice: drop it rather than play the whole file.
  return tracks.flatMap((t): TrackRef[] => {
    if (t.cue || !isCuePath(t.path)) return [t]
    const r = found.get(t.path)
    return r ? [{ path: t.path, file: cueRealPath(t.path), title: r.title, cue: { startSec: r.startSec, endSec: r.endSec } }] : []
  })
}

export function dispatch(raw: unknown): void {
  const parsed = PlaybackCommandSchema.safeParse(raw)
  if (!parsed.success) return
  const cmd = parsed.data
  if (cmd.type !== 'load') return sendToEngine(cmd)
  lastQueue = cmd.tracks.map((t) => t.path)
  if (!cmd.tracks.some((t) => isCuePath(t.path))) return sendToEngine(cmd)
  void resolveCues(cmd.tracks).then((tracks) => {
    if (tracks.length) sendToEngine({ ...cmd, tracks, index: Math.min(cmd.index, tracks.length - 1) })
  })
}

export function shutdownEngine(): void {
  decoder?.kill()
  decoder = null
  win?.destroy()
  win = null
}
