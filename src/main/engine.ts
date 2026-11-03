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

/** Paths of the queue as the engine reports it (play order), saved with the session at quit. */
let queuePaths: string[] = []
export const currentQueue = (): string[] => queuePaths
export const setQueuePaths = (p: string[]): void => { queuePaths = p }

/** Looks up start/end/title for CUE virtual paths (the library DB owns them). */
type CueLookup = (paths: string[]) => Promise<Array<{ path: string; title: string; startSec: number; endSec: number }>>
let cueLookup: CueLookup | null = null
export const setCueLookup = (f: CueLookup): void => { cueLookup = f }

/** ReplayGain tags live in the library DB; refs are stamped with them before the engine sees the queue. */
type GainLookup = (paths: string[]) => Promise<Array<{ path: string; gainDb: number | null; peak: number | null }>>
let gainLookup: GainLookup | null = null
export const setGainLookup = (f: GainLookup): void => { gainLookup = f }

async function resolveCues(tracks: TrackRef[]): Promise<TrackRef[]> {
  const wanted = tracks.filter((t) => !t.cue && isCuePath(t.path)).map((t) => t.path)
  if (!wanted.length || !cueLookup) return tracks
  const found = new Map((await cueLookup(wanted)).map((r) => [r.path, r]))
  // A virtual path with no row (sheet deleted since) can't be played as a slice: drop it rather than play the whole file.
  return tracks.flatMap((t): TrackRef[] => {
    if (t.cue || !isCuePath(t.path)) return [t]
    const r = found.get(t.path)
    return r ? [{ ...t, path: t.path, file: cueRealPath(t.path), title: r.title, cue: { startSec: r.startSec, endSec: r.endSec } }] : []
  })
}

async function stampGain(tracks: TrackRef[]): Promise<TrackRef[]> {
  if (!gainLookup) return tracks
  try {
    const found = new Map((await gainLookup(tracks.filter((t) => t.gainDb === undefined).map((t) => t.path))).map((r) => [r.path, r]))
    return tracks.map((t) => {
      const g = found.get(t.path)
      return g ? { ...t, gainDb: g.gainDb, peak: g.peak } : t
    })
  } catch {
    return tracks // no library yet: play without ReplayGain rather than not at all
  }
}

const prepare = async (tracks: TrackRef[]): Promise<TrackRef[]> => stampGain(await resolveCues(tracks))

/** Commands run strictly in the order they arrive, even when some need an async library lookup first. */
let chain: Promise<void> = Promise.resolve()

/** Validate untrusted renderer input before it reaches the engine. */
export function dispatch(raw: unknown): void {
  const parsed = PlaybackCommandSchema.safeParse(raw)
  if (!parsed.success) return
  const cmd = parsed.data
  if (cmd.type !== 'load' && cmd.type !== 'enqueue') {
    chain = chain.then(() => sendToEngine(cmd))
    return
  }
  chain = chain.then(async () => {
    const tracks = await prepare(cmd.tracks)
    if (!tracks.length) return
    if (cmd.type === 'load') sendToEngine({ ...cmd, tracks, index: Math.min(cmd.index, tracks.length - 1) })
    else sendToEngine({ ...cmd, tracks })
  })
}

export function shutdownEngine(): void {
  decoder?.kill()
  decoder = null
  win?.destroy()
  win = null
}
