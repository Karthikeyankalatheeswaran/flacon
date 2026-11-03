import { createHash } from 'node:crypto'
import { z } from 'zod'

// Fetcher core: everything that decides what is safe to download, where it may land and when it may run.
// Pure (no I/O), so the rules that protect the user's disk are unit-tested.

export const FETCH_LIMITS = {
  concurrency: 3,
  maxZipEntries: 500,
  maxZipBytes: 4 * 1024 ** 3, // total uncompressed
  maxEntryBytes: 2 * 1024 ** 3,
  maxCompressionRatio: 200, // zip-bomb guard
  minFreeBytes: 512 * 1024 ** 2, // keep this much free after the download
  hostMinIntervalMs: 1000,
  userAgent: 'Flacon/0.1 (+https://flacon.app; personal music library; honest-client)'
} as const

// ---- URLs ----------------------------------------------------------------------------------------

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./]

/** True for loopback / private / link-local hosts (SSRF guard). DNS rebinding is checked again at connect time. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (PRIVATE_V4.some((r) => r.test(h))) return true
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
  return !!mapped && PRIVATE_V4.some((r) => r.test(mapped[1]!))
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

/** Only https, no embedded credentials, no private network targets. */
export function checkFetchUrl(raw: string): UrlCheck {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'That doesn’t look like a link.' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only secure (https) links are supported.' }
  if (url.username || url.password) return { ok: false, reason: 'Links with a username or password are not supported.' }
  if (isPrivateHost(url.hostname)) return { ok: false, reason: 'Links to this computer or local network are not allowed.' }
  return { ok: true, url }
}

// ---- Filenames -----------------------------------------------------------------------------------

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g

/** One path segment: NFC, no illegal characters, no reserved device names, no trailing dots/spaces, bounded length. */
export function sanitizeSegment(input: string, max = 120): string {
  let s = input.normalize('NFC').replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/, '').replace(/^\.+/, '_') // trailing dots/spaces are illegal on Windows; leading dots hide files
  if (!s) s = '_'
  if (RESERVED.test(s.split('.')[0]!)) s = '_' + s
  if (Buffer.byteLength(s) > max) {
    const hash = createHash('sha1').update(s).digest('hex').slice(0, 8)
    let cut = s
    while (Buffer.byteLength(cut) > max - 9) cut = [...cut].slice(0, -1).join('')
    s = `${cut.replace(/[. ]+$/, '')}~${hash}`
  }
  return s
}

export interface TemplateTags { albumartist: string; album: string; year?: number | null; disc?: number | null; track?: number | null; title: string; ext: string }
export const DEFAULT_TEMPLATE = '{albumartist}/{album} ({year})/{disc}-{track} {title}'

const pad = (n: number | null | undefined): string => (n && n > 0 ? String(n).padStart(2, '0') : '')

/** Render the naming template into relative path segments. Missing fields collapse cleanly ("()" and "-" never dangle). */
export function renderTemplate(template: string, t: TemplateTags): string[] {
  const values: Record<string, string> = {
    albumartist: t.albumartist || 'Unknown Artist',
    album: t.album || 'Unknown Album',
    year: t.year ? String(t.year) : '',
    disc: t.disc && t.disc > 1 ? String(t.disc) : '', // single-disc albums: no "1-" prefix
    track: pad(t.track),
    title: t.title || 'Untitled'
  }
  const segs = template.split('/').map((seg) => {
    let out = seg.replace(/\{(\w+)\}/g, (_m, k: string) => values[k] ?? '')
    out = out.replace(/\(\s*\)/g, '').replace(/^[-\s]+/, '').replace(/\s{2,}/g, ' ').trim()
    return sanitizeSegment(out)
  })
  const last = segs.length - 1
  segs[last] = sanitizeSegment(`${segs[last]}.${t.ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'flac'}`.replace(/\.(\w+)\.\1$/, '.$1'))
  return segs
}

/** Case-insensitive collision handling (macOS/Windows volumes): "a.flac" taken → "a (2).flac". Mutates `taken`. */
export function uniquePath(path: string, taken: Set<string>): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  const [stem, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, '']
  let candidate = path
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
  taken.add(candidate.toLowerCase())
  return candidate
}

// ---- ZIP safety ----------------------------------------------------------------------------------

const ZIP_KEEP = new Set(['flac', 'alac', 'm4a', 'wav', 'aiff', 'aif', 'ape', 'wv', 'ogg', 'opus', 'mp3', 'dsf', 'dff', 'jpg', 'jpeg', 'png', 'webp', 'cue', 'log'])
export const zipExt = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

export type EntryDecision = { keep: true; rel: string } | { keep: false; reason: 'unsafe' | 'ignored' | 'too-big' | 'ratio' }

/** Decide per ZIP entry: zip-slip paths are rejected outright; only audio/artwork/cue/log files are extracted. */
export function checkZipEntry(e: { name: string; size: number; compressed: number }): EntryDecision {
  const raw = e.name
  if (raw.endsWith('/')) return { keep: false, reason: 'ignored' }
  const norm = raw.replace(/\\/g, '/')
  const parts = norm.split('/')
  if (norm.startsWith('/') || /^[a-z]:/i.test(norm) || parts.includes('..') || raw.includes('\0')) return { keep: false, reason: 'unsafe' }
  if (parts.some((p) => p.startsWith('__MACOSX') || p === '.DS_Store' || p.startsWith('._'))) return { keep: false, reason: 'ignored' }
  if (!ZIP_KEEP.has(zipExt(norm))) return { keep: false, reason: 'ignored' }
  if (e.size > FETCH_LIMITS.maxEntryBytes) return { keep: false, reason: 'too-big' }
  if (e.compressed > 0 && e.size / e.compressed > FETCH_LIMITS.maxCompressionRatio && e.size > 10 * 1024 ** 2) return { keep: false, reason: 'ratio' }
  return { keep: true, rel: parts.map((p) => sanitizeSegment(p)).join('/') }
}

// ---- Scheduling ----------------------------------------------------------------------------------

/** Full-jitter exponential backoff, capped at 60 s. `rand` is injectable for tests. */
export function backoffMs(attempt: number, rand = Math.random()): number {
  const cap = Math.min(60_000, 1000 * 2 ** attempt)
  return Math.round(cap / 2 + (cap / 2) * rand)
}

/** Per-host spacing so one site is never hammered, whatever the global concurrency. */
export class HostLimiter {
  private next = new Map<string, number>()
  constructor(private minMs: number = FETCH_LIMITS.hostMinIntervalMs, private now: () => number = Date.now) {}
  /** Milliseconds to wait before the next request to `host`; reserves the slot. */
  take(host: string): number {
    const t = this.now()
    const at = Math.max(t, this.next.get(host) ?? 0)
    this.next.set(host, at + this.minMs)
    return at - t
  }
}

// ---- Jobs ----------------------------------------------------------------------------------------

export const LicenseSchema = z.object({ name: z.string().max(120), url: z.string().url().max(500).optional(), attribution: z.string().max(300).optional() })
export type License = z.infer<typeof LicenseSchema>

export const JobStatusSchema = z.enum(['queued', 'downloading', 'verifying', 'importing', 'paused', 'done', 'failed', 'canceled'])
export type JobStatus = z.infer<typeof JobStatusSchema>

export const FetchItemSchema = z.object({
  provider: z.enum(['archive', 'jamendo', 'link']),
  title: z.string().min(1).max(300),
  artist: z.string().max(300).default(''),
  album: z.string().max(300).default(''),
  url: z.string().url().max(2000),
  format: z.string().max(20).default(''),
  size: z.number().int().min(0).default(0),
  license: LicenseSchema.optional()
})
export type FetchItem = z.infer<typeof FetchItemSchema>

export interface FetchJob {
  id: string
  item: FetchItem
  status: JobStatus
  received: number
  total: number
  attempt: number
  /** Epoch ms before which a failed job must not retry (backoff). */
  retryAt: number
  error: string | null
  /** Result of post-processing, shown as quality notes on the job. */
  notes: string[]
  createdAt: number
}

const ACTIVE: JobStatus[] = ['downloading', 'verifying', 'importing']
export const isActive = (j: FetchJob): boolean => ACTIVE.includes(j.status)

/** Next jobs to start: FIFO among queued jobs whose backoff has elapsed, up to the concurrency limit. */
export function nextRunnable(jobs: FetchJob[], now: number, limit: number = FETCH_LIMITS.concurrency): FetchJob[] {
  const free = limit - jobs.filter(isActive).length
  if (free <= 0) return []
  return jobs.filter((j) => j.status === 'queued' && j.retryAt <= now).sort((a, b) => a.createdAt - b.createdAt).slice(0, free)
}

/** After a restart nothing is actually running: in-flight jobs go back to the queue (resumed via Range), paused stay paused. */
export function recoverJobs(jobs: FetchJob[]): FetchJob[] {
  return jobs.map((j) => (isActive(j) ? { ...j, status: 'queued' as const } : j))
}
