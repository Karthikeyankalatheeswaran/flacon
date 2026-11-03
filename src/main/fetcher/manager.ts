import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FETCH_LIMITS, FetchItemSchema, HostLimiter, backoffMs, isActive, nextRunnable, recoverJobs, sanitizeSegment, type FetchItem, type FetchJob } from '@shared/fetch'
import { DownloadError, download, type FetchFn } from './download'
import { PostError, importCover, importFile } from './postprocess'
import { extractZip } from './zip'

const MAX_ATTEMPTS = 5
const AUDIO = /\.(flac|wav|aiff?|alac|m4a|ape|wv|ogg|opus|mp3|dsf|dff)$/i

export interface ManagerDeps {
  /** Staging area: downloads live in `<dir>/incoming/<jobId>/` until imported. */
  dir: string
  libraryRoot: string
  jobsFile: string
  fetchFn: FetchFn
  ffmpeg: string
  onChange(jobs: FetchJob[]): void
  /** Called after files landed in the library so it can rescan. */
  onImported?(): void
  now?: () => number
  rand?: () => number
  freeBytes?: (dir: string) => Promise<number>
  sleep?: (ms: number) => Promise<void>
  concurrency?: number
}

type Intent = 'pause' | 'cancel'

export class FetchManager {
  private jobs: FetchJob[] = []
  private aborts = new Map<string, AbortController>()
  private intents = new Map<string, Intent>()
  private running = new Set<Promise<void>>()
  private limiter = new HostLimiter()
  private timer: NodeJS.Timeout | undefined
  private saveTimer: NodeJS.Timeout | undefined
  private seq = 0
  constructor(private d: ManagerDeps) {}

  private now = (): number => (this.d.now ?? Date.now)()

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.d.jobsFile, 'utf8')) as FetchJob[]
      // Anything malformed is dropped rather than trusted: the file lives in a user-writable folder.
      this.jobs = recoverJobs(raw.filter((j) => j && typeof j.id === 'string' && FetchItemSchema.safeParse(j.item).success))
    } catch {
      this.jobs = []
    }
    this.pump()
  }

  list(): FetchJob[] {
    return this.jobs
  }

  enqueue(items: FetchItem[]): FetchJob[] {
    const added = items.map((raw) => {
      const item = FetchItemSchema.parse(raw)
      const job: FetchJob = { id: `${this.now().toString(36)}-${(++this.seq).toString(36)}`, item, status: 'queued', received: 0, total: item.size, attempt: 0, retryAt: 0, error: null, notes: [], createdAt: this.now() + this.seq }
      return job
    })
    this.jobs.push(...added)
    this.changed()
    this.pump()
    return added
  }

  /** A file already on disk (e.g. a purchase ZIP in Downloads). It is copied, never moved, so the user's file stays put. */
  enqueueLocal(path: string, title: string): FetchJob[] {
    if (this.jobs.some((j) => j.item.url === pathToFileURL(path).toString() && j.status !== 'failed' && j.status !== 'canceled')) return []
    return this.enqueue([{ provider: 'link', title, artist: '', album: '', url: pathToFileURL(path).toString(), format: path.slice(path.lastIndexOf('.') + 1).toLowerCase(), size: 0 }])
  }

  pause(id: string): void {
    const j = this.get(id)
    if (!j) return
    if (isActive(j)) {
      this.intents.set(id, 'pause')
      this.aborts.get(id)?.abort()
    } else if (j.status === 'queued') this.set(j, { status: 'paused' })
  }

  resume(id: string): void {
    const j = this.get(id)
    if (j && (j.status === 'paused' || j.status === 'failed' || j.status === 'canceled')) {
      this.set(j, { status: 'queued', error: null, retryAt: 0, attempt: j.status === 'failed' ? 0 : j.attempt })
      this.pump()
    }
  }

  cancel(id: string): void {
    const j = this.get(id)
    if (!j) return
    if (isActive(j)) {
      this.intents.set(id, 'cancel')
      this.aborts.get(id)?.abort()
    } else {
      this.set(j, { status: 'canceled' })
      void this.cleanup(j)
    }
  }

  /** Remove finished/failed/canceled jobs from the list. */
  clear(): void {
    this.jobs = this.jobs.filter((j) => j.status !== 'done' && j.status !== 'failed' && j.status !== 'canceled')
    this.changed()
  }

  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running])
  }

  stop(): void {
    clearTimeout(this.timer)
    for (const a of this.aborts.values()) a.abort()
  }

  private get(id: string): FetchJob | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  private set(j: FetchJob, patch: Partial<FetchJob>): void {
    Object.assign(j, patch)
    this.changed()
  }

  private changed(): void {
    this.d.onChange(this.jobs)
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), 300)
  }

  async save(): Promise<void> {
    clearTimeout(this.saveTimer)
    try {
      await fs.mkdir(dirname(this.d.jobsFile), { recursive: true })
      const tmp = this.d.jobsFile + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(this.jobs))
      await fs.rename(tmp, this.d.jobsFile)
    } catch {
      /* queue just won't persist */
    }
  }

  private pump(): void {
    clearTimeout(this.timer)
    const now = this.now()
    for (const j of nextRunnable(this.jobs, now, this.d.concurrency ?? FETCH_LIMITS.concurrency)) {
      this.set(j, { status: 'downloading' })
      const p = this.run(j).finally(() => {
        this.running.delete(p)
        this.pump()
      })
      this.running.add(p)
    }
    const waiting = this.jobs.filter((j) => j.status === 'queued' && j.retryAt > now).map((j) => j.retryAt)
    if (waiting.length) this.timer = setTimeout(() => this.pump(), Math.max(50, Math.min(...waiting) - now))
  }

  private stagingDir(j: FetchJob): string {
    return join(this.d.dir, 'incoming', j.id)
  }

  private async cleanup(j: FetchJob): Promise<void> {
    await fs.rm(this.stagingDir(j), { recursive: true, force: true })
  }

  private async run(j: FetchJob): Promise<void> {
    const ac = new AbortController()
    this.aborts.set(j.id, ac)
    try {
      const url = new URL(j.item.url)
      const name = sanitizeSegment(decodeURIComponent(basename(url.pathname)) || `${j.item.title}.${j.item.format || 'bin'}`)
      const staged = join(this.stagingDir(j), name)
      if (url.protocol === 'file:') {
        await fs.mkdir(dirname(staged), { recursive: true })
        await fs.copyFile(fileURLToPath(url), staged)
      } else await download(j.item.url, staged, {
        fetchFn: this.d.fetchFn, signal: ac.signal, limiter: this.limiter, freeBytes: this.d.freeBytes, sleep: this.d.sleep,
        onProgress: (received, total) => { j.received = received; j.total = total; this.d.onChange(this.jobs) }
      })

      this.set(j, { status: 'verifying' })
      let audio: string[]
      if (/\.zip$/i.test(staged)) {
        const out = join(this.stagingDir(j), 'x')
        const z = await extractZip(staged, out, ac.signal)
        audio = z.files.filter((f) => AUDIO.test(f))
        if (!audio.length) throw new PostError('The ZIP didn’t contain any audio files.')
        if (z.skipped.length) j.notes.push(`${z.skipped.length} unsafe file${z.skipped.length === 1 ? '' : 's'} in the ZIP ignored.`)
      } else audio = [staged]

      this.set(j, { status: 'importing' })
      const notes: string[] = []
      let imported = 0
      let rejected = 0
      for (const f of audio) {
        try {
          const r = await importFile(f, j.item, { ffmpeg: this.d.ffmpeg, libraryRoot: this.d.libraryRoot })
          notes.push(...r.notes.map((n) => (audio.length > 1 ? `${basename(f)}: ${n}` : n)))
          if (!r.duplicate) imported++
          await importCover(dirname(f), dirname(r.dest))
        } catch (e) {
          if (!(e instanceof PostError)) throw e
          rejected++
          notes.push(`${basename(f)}: ${e.message}`)
        }
      }
      if (imported === 0 && rejected > 0) throw new PostError(notes[0] ?? 'Nothing could be imported.')
      this.set(j, { status: 'done', notes: [...j.notes, ...notes], error: null })
      await this.cleanup(j)
      if (imported > 0) this.d.onImported?.()
    } catch (e) {
      await this.fail(j, e)
    } finally {
      this.aborts.delete(j.id)
      this.intents.delete(j.id)
      this.changed()
    }
  }

  private async fail(j: FetchJob, e: unknown): Promise<void> {
    const intent = this.intents.get(j.id)
    if (intent === 'cancel') {
      this.set(j, { status: 'canceled', error: null })
      await this.cleanup(j) // cancellation removes the partial data
      return
    }
    if (intent === 'pause') {
      this.set(j, { status: 'paused', error: null }) // .part stays for a Range resume
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    const permanent = e instanceof PostError || (e instanceof DownloadError && e.permanent)
    if (permanent || j.attempt + 1 >= MAX_ATTEMPTS) {
      this.set(j, { status: 'failed', error: msg })
      if (e instanceof PostError) await this.cleanup(j)
      return
    }
    const attempt = j.attempt + 1
    this.set(j, { status: 'queued', attempt, retryAt: this.now() + backoffMs(attempt - 1, (this.d.rand ?? Math.random)()), error: `${msg} Retrying…` })
  }
}
