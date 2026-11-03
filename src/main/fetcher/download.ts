import { createWriteStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { FETCH_LIMITS, HostLimiter, checkFetchUrl } from '@shared/fetch'

export type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' }) => Promise<Response>

export class DownloadError extends Error {
  /** Permanent errors (404, 403, bad link) are not retried; transient ones (5xx, network) are. */
  constructor(message: string, readonly permanent: boolean) {
    super(message)
  }
}

export interface DownloadOptions {
  fetchFn: FetchFn
  signal: AbortSignal
  limiter?: HostLimiter
  onProgress?: (received: number, total: number) => void
  /** Free-space probe, injectable for tests. Returns bytes available at `dir`. */
  freeBytes?: (dir: string) => Promise<number>
  sleep?: (ms: number) => Promise<void>
}

const MAX_REDIRECTS = 5
const defaultFree = async (dir: string): Promise<number> => {
  const s = await fs.statfs(dir)
  return s.bavail * s.bsize
}
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Follow redirects by hand so every hop is re-checked against the https / no-private-network rules. */
async function open(url: string, headers: Record<string, string>, o: DownloadOptions): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = checkFetchUrl(current)
    if (!check.ok) throw new DownloadError(check.reason, true)
    const wait = o.limiter?.take(check.url.host) ?? 0
    if (wait > 0) await (o.sleep ?? defaultSleep)(wait)
    const res = await o.fetchFn(current, { headers: { 'User-Agent': FETCH_LIMITS.userAgent, ...headers }, signal: o.signal, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).toString()
      continue
    }
    return res
  }
  throw new DownloadError('Too many redirects.', true)
}

/**
 * Download `url` to `dest` via `dest + '.part'`, resuming with an HTTP Range request when a partial file exists.
 * The final rename is atomic, so `dest` only ever appears complete. Aborting leaves the .part for a later resume.
 */
export async function download(url: string, dest: string, o: DownloadOptions): Promise<{ bytes: number }> {
  const part = dest + '.part'
  await fs.mkdir(dirname(dest), { recursive: true })
  let have = 0
  try {
    have = (await fs.stat(part)).size
  } catch {
    /* fresh download */
  }

  const res = await open(url, have > 0 ? { Range: `bytes=${have}-` } : {}, o)
  if (res.status === 416) {
    // Range not satisfiable: the .part is already the whole file (or garbage). Trust a matching total, else restart.
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? NaN)
    if (total === have) {
      await fs.rename(part, dest)
      return { bytes: have }
    }
    await fs.rm(part, { force: true })
    return download(url, dest, o)
  }
  if (res.status === 404 || res.status === 403 || res.status === 401 || res.status === 410) throw new DownloadError(`The server refused the download (${res.status}).`, true)
  if (!res.ok || !res.body) throw new DownloadError(`The server answered ${res.status}.`, res.status < 500 && res.status !== 429)

  const resumed = res.status === 206 && have > 0
  if (!resumed) have = 0 // server ignored Range: start over
  const remaining = Number(res.headers.get('content-length') ?? 0)
  const total = have + remaining
  if (remaining > 0) {
    const free = await (o.freeBytes ?? defaultFree)(dirname(dest))
    if (free - remaining < FETCH_LIMITS.minFreeBytes) throw new DownloadError('Not enough free disk space for this download.', true)
  }

  let received = have
  // NB: no extra 'data' listener on this stream (for progress): alongside the consumer it intermittently corrupted the written file. Progress is reported from the write loop.
  const body = Readable.fromWeb(res.body as never)
  // flags 'a' to append when resuming, 'w' to truncate when restarting.
  const fh = await fs.open(part, resumed ? 'a' : 'w')
  try {
    // Sequential awaited writes (no stream coalescing): each chunk is on disk before the next is taken.
    for await (const chunk of body) {
      if (o.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      await fh.write(chunk as Uint8Array)
      received += (chunk as Uint8Array).length
      o.onProgress?.(received, total)
    }
  } finally {
    body.destroy()
    await fh.close()
  }
  if (total > 0 && received !== total) throw new DownloadError('The download ended early.', false)
  await fs.rename(part, dest)
  return { bytes: received }
}
