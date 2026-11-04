import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { AnalysisProgress, LibraryProgress, LibraryRequest } from '@shared/library'

// Main-side proxy to the library worker: request/response over parentPort, plus pushed events.
let proc: UtilityProcess | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let progress: LibraryProgress = { phase: 'idle', done: 0, total: 0, denied: [] }
let onProgress: (p: LibraryProgress) => void = () => {}
let onChanged: () => void = () => {}
let onActivity: () => void = () => {}
let onAnalysis: (p: AnalysisProgress) => void = () => {}
let ffmpegPath = ''
let initPromise: Promise<unknown> | null = null

export const getProgress = (): LibraryProgress => progress

function spawn(): UtilityProcess {
  const p = utilityProcess.fork(join(__dirname, 'library.js'), [], { serviceName: 'flacon-library' })
  p.on('message', (m: { id?: number; ok?: boolean; data?: unknown; error?: string; event?: string; progress?: LibraryProgress & AnalysisProgress }) => {
    if (m.event === 'progress' && m.progress) {
      progress = m.progress
      onProgress(progress)
    } else if (m.event === 'changed') onChanged()
    else if (m.event === 'activity') onActivity()
    else if (m.event === 'analysis' && m.progress) onAnalysis({ done: m.progress.done, total: m.progress.total, loud: m.progress.loud })
    else if (m.id !== undefined) {
      const w = pending.get(m.id)
      pending.delete(m.id)
      if (m.ok) w?.resolve(m.data)
      else w?.reject(new Error(m.error))
    }
  })
  p.on('exit', () => {
    // Worker crash: fail in-flight requests and respawn lazily on the next call.
    for (const w of pending.values()) w.reject(new Error('library worker exited'))
    pending.clear()
    proc = null
    initPromise = null
  })
  return p
}

function send<T>(req: LibraryRequest): Promise<T> {
  if (!proc) proc = spawn()
  return new Promise<T>((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    proc!.postMessage({ id, req })
  })
}

/** Start (or restart after a crash) the worker and open the DB. Resolves with recovery info. */
export function startLibrary(handlers: { progress: (p: LibraryProgress) => void; changed: () => void; activity: () => void; analysis: (p: AnalysisProgress) => void; ffmpeg: string }): Promise<{ recoveredFrom: string | null }> {
  onProgress = handlers.progress
  onChanged = handlers.changed
  onActivity = handlers.activity
  onAnalysis = handlers.analysis
  ffmpegPath = handlers.ffmpeg
  return ensureReady() as Promise<{ recoveredFrom: string | null }>
}

function ensureReady(): Promise<unknown> {
  if (!initPromise) initPromise = send({ op: 'init', dbPath: join(app.getPath('userData'), 'library.db'), artDir: join(app.getPath('userData'), 'art'), lyricsDir: lyricsDir(), ffmpeg: ffmpegPath })
  return initPromise
}

export function call<T = unknown>(req: LibraryRequest): Promise<T> {
  return ensureReady().then(() => send<T>(req))
}

export const lyricsDir = (): string => join(app.getPath('userData'), 'lyrics')
export const artDir = (): string => join(app.getPath('userData'), 'art')
export function stopLibrary(): void {
  proc?.kill()
  proc = null
}
