import { promises as fs, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, net } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import yauzl from 'yauzl'
import type { FetchJob } from '@shared/fetch'
import { HostLimiter } from '@shared/fetch'
import { FetchSettingsSchema, defaultFetchSettings, type EnqueueResponse, type FetchSettings, type SearchResponse } from '@shared/fetchIpc'
import { z } from 'zod'
import type { FetchFn } from './download'
import { FetchManager } from './manager'
import { PROVIDERS, ProviderError, type ProviderCtx } from './providers'

interface ServiceDeps {
  ffmpeg: string
  onJobs(jobs: FetchJob[]): void
  /** Add the managed library folder (idempotent) and rescan. */
  onImported(libraryRoot: string): void
}

// net.fetch uses Chromium's network stack, so the system proxy and certificate store apply.
const fetchFn: FetchFn = (url, init) => net.fetch(url, init as RequestInit) as Promise<Response>

let manager: FetchManager | null = null
let settings: FetchSettings = defaultFetchSettings
let watcher: FSWatcher | null = null
const limiter = new HostLimiter()
let searchAbort: AbortController | null = null

const settingsFile = (): string => join(app.getPath('userData'), 'fetch-settings.json')
const libraryRoot = (): string => join(app.getPath('music'), 'Flacon')

function loadSettings(): FetchSettings {
  try {
    const r = FetchSettingsSchema.safeParse(JSON.parse(readFileSync(settingsFile(), 'utf8')))
    return r.success ? r.data : defaultFetchSettings
  } catch {
    return defaultFetchSettings
  }
}

function ctx(signal: AbortSignal): ProviderCtx {
  return { fetchFn, limiter, signal, jamendoClientId: settings.jamendoClientId || undefined }
}

const errMsg = (e: unknown): string => (e instanceof ProviderError ? e.message : 'Something went wrong. Please try again.')

export async function startFetcher(deps: ServiceDeps): Promise<void> {
  settings = loadSettings()
  manager = new FetchManager({
    dir: join(app.getPath('userData'), 'fetch'),
    libraryRoot: libraryRoot(),
    jobsFile: join(app.getPath('userData'), 'fetch-jobs.json'),
    fetchFn,
    ffmpeg: deps.ffmpeg,
    onChange: deps.onJobs,
    onImported: () => deps.onImported(libraryRoot())
  })
  await manager.load()
  applyWatch()
}

export function stopFetcher(): void {
  void watcher?.close()
  void manager?.save()
  manager?.stop()
}

export const fetchList = (): FetchJob[] => manager?.list() ?? []
export const getFetchSettings = (): FetchSettings => settings

export function setFetchSettings(next: FetchSettings): FetchSettings {
  settings = FetchSettingsSchema.parse(next)
  try {
    writeFileSync(settingsFile(), JSON.stringify(settings))
  } catch {
    /* read-only profile */
  }
  applyWatch()
  return settings
}

export async function fetchSearch(provider: keyof typeof PROVIDERS, query: string): Promise<SearchResponse> {
  searchAbort?.abort()
  searchAbort = new AbortController()
  try {
    return { ok: true, results: await PROVIDERS[provider].search(query, ctx(searchAbort.signal)) }
  } catch (e) {
    if (searchAbort.signal.aborted) return { ok: true, results: [] } // superseded by a newer search
    return { ok: false, error: errMsg(e) }
  }
}

export async function fetchEnqueue(provider: keyof typeof PROVIDERS, id: string): Promise<EnqueueResponse> {
  try {
    const items = await PROVIDERS[provider].resolve(id, ctx(new AbortController().signal))
    const jobs = manager!.enqueue(items)
    return { ok: true, count: jobs.length }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

export function fetchControl(op: 'pause' | 'resume' | 'cancel' | 'clear', id?: string): void {
  if (op === 'clear') return manager?.clear()
  if (id) manager?.[op](id)
}

/** Does this ZIP hold audio? (Central directory only: nothing is extracted.) */
function zipHasAudio(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, z) => {
      if (err || !z) return resolve(false)
      z.on('entry', (e: yauzl.Entry) => (/\.(flac|wav|aiff?|alac|ape|wv)$/i.test(e.fileName) ? (z.close(), resolve(true)) : z.readEntry()))
      z.on('end', () => resolve(false))
      z.on('error', () => resolve(false))
      z.readEntry()
    })
  })
}

/** Opt-in: watch Downloads for purchase ZIPs that contain lossless audio and import a copy. */
function applyWatch(): void {
  void watcher?.close()
  watcher = null
  if (!settings.watchDownloads) return
  const dir = app.getPath('downloads')
  watcher = chokidar.watch(dir, { depth: 0, ignoreInitial: true, followSymlinks: false, awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 } })
  watcher.on('add', (p) => {
    if (!/\.zip$/i.test(p)) return
    void fs.stat(p).then(async (st) => {
      if (st.isFile() && (await zipHasAudio(p))) manager?.enqueueLocal(p, basename(p).replace(/\.zip$/i, ''))
    }).catch(() => {})
  })
}

export const activeCount = (): number => z.number().parse(manager?.list().filter((j) => j.status !== 'done' && j.status !== 'failed' && j.status !== 'canceled').length ?? 0)
