import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { HostLimiter } from '@shared/fetch'
import { DownloadError, download, type FetchFn } from './download'

const dir = mkdtempSync(join(tmpdir(), 'flacon-dl-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const DATA = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251))
const free = async (): Promise<number> => 10 * 1024 ** 3

/** Serves DATA with Range support; `ignoreRange` simulates a server that always answers 200. */
const server = (opts: { ignoreRange?: boolean; status?: number; redirectTo?: string; cut?: number } = {}): { fn: FetchFn; calls: Array<{ url: string; range?: string }> } => {
  const calls: Array<{ url: string; range?: string }> = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, range: init.headers['Range'] })
    if (opts.redirectTo && calls.length === 1) return new Response(null, { status: 302, headers: { location: opts.redirectTo } })
    if (opts.status) return new Response('x', { status: opts.status })
    const m = /bytes=(\d+)-/.exec(init.headers['Range'] ?? '')
    const start = m && !opts.ignoreRange ? Number(m[1]) : 0
    const body = DATA.subarray(start, opts.cut ?? DATA.length)
    return new Response(body, { status: start > 0 ? 206 : 200, headers: { 'content-length': String(DATA.length - start) } })
  }
  return { fn, calls }
}
const opts = (fn: FetchFn) => ({ fetchFn: fn, signal: new AbortController().signal, freeBytes: free, sleep: async () => {} })

describe('download', () => {
  it('downloads via .part and renames atomically', async () => {
    const dest = join(dir, 'a', 'one.flac')
    const progress: number[] = []
    const r = await download('https://example.com/one.flac', dest, { ...opts(server().fn), onProgress: (n) => progress.push(n) })
    expect(r.bytes).toBe(DATA.length)
    expect(readFileSync(dest).equals(DATA)).toBe(true)
    expect(existsSync(dest + '.part')).toBe(false)
    expect(progress.at(-1)).toBe(DATA.length)
  })
  it('resumes from an existing .part with a Range request', async () => {
    const dest = join(dir, 'resume.flac')
    writeFileSync(dest + '.part', DATA.subarray(0, 1200))
    const s = server()
    await download('https://example.com/r.flac', dest, opts(s.fn))
    expect(s.calls[0]!.range).toBe('bytes=1200-')
    expect(readFileSync(dest).equals(DATA)).toBe(true)
  })
  it('restarts cleanly when the server ignores Range', async () => {
    const dest = join(dir, 'norange.flac')
    writeFileSync(dest + '.part', Buffer.from('stale garbage'))
    await download('https://example.com/n.flac', dest, opts(server({ ignoreRange: true }).fn))
    expect(readFileSync(dest).equals(DATA)).toBe(true)
  })
  it('treats a complete .part (416) as done', async () => {
    const dest = join(dir, 'done.flac')
    writeFileSync(dest + '.part', DATA)
    const fn: FetchFn = async () => new Response(null, { status: 416, headers: { 'content-range': `bytes */${DATA.length}` } })
    await download('https://example.com/d.flac', dest, opts(fn))
    expect(readFileSync(dest).equals(DATA)).toBe(true)
  })
  it('keeps the .part and reports a transient error when the stream ends early', async () => {
    const dest = join(dir, 'cut.flac')
    await expect(download('https://example.com/c.flac', dest, opts(server({ cut: 2000 }).fn))).rejects.toMatchObject({ permanent: false })
    expect(existsSync(dest)).toBe(false)
    expect(readFileSync(dest + '.part').length).toBe(2000)
  })
  it('classifies HTTP errors as permanent (404) or retryable (503)', async () => {
    await expect(download('https://example.com/x', join(dir, 'x'), opts(server({ status: 404 }).fn))).rejects.toMatchObject({ permanent: true })
    await expect(download('https://example.com/y', join(dir, 'y'), opts(server({ status: 503 }).fn))).rejects.toMatchObject({ permanent: false })
    await expect(download('https://example.com/z', join(dir, 'z'), opts(server({ status: 429 }).fn))).rejects.toMatchObject({ permanent: false })
  })
  it('blocks http links and redirects into the private network', async () => {
    await expect(download('http://example.com/a', join(dir, 'h'), opts(server().fn))).rejects.toBeInstanceOf(DownloadError)
    const s = server({ redirectTo: 'https://169.254.169.254/latest' })
    await expect(download('https://example.com/a', join(dir, 'ssrf'), opts(s.fn))).rejects.toMatchObject({ permanent: true })
    expect(s.calls).toHaveLength(1) // never contacted the metadata address
  })
  it('follows safe redirects', async () => {
    const s = server({ redirectTo: 'https://cdn.example.net/file.flac' })
    await download('https://example.com/a', join(dir, 'redir.flac'), opts(s.fn))
    expect(s.calls.map((c) => c.url)).toEqual(['https://example.com/a', 'https://cdn.example.net/file.flac'])
  })
  it('refuses when free space would drop below the reserve', async () => {
    await expect(download('https://example.com/a', join(dir, 'full.flac'), { ...opts(server().fn), freeBytes: async () => 100 })).rejects.toMatchObject({ permanent: true, message: /disk space/ })
  })
  it('honours per-host spacing', async () => {
    const waits: number[] = []
    let t = 0
    const limiter = new HostLimiter(1000, () => t)
    const o = { ...opts(server().fn), limiter, sleep: async (ms: number) => void waits.push(ms) }
    await download('https://example.com/1', join(dir, 'l1'), o)
    await download('https://example.com/2', join(dir, 'l2'), o)
    expect(waits).toEqual([1000])
  })
  it('stops on abort and leaves the .part for resume', async () => {
    const ac = new AbortController()
    const fn: FetchFn = async () => {
      ac.abort()
      throw new DOMException('aborted', 'AbortError')
    }
    await expect(download('https://example.com/a', join(dir, 'ab.flac'), { ...opts(fn), signal: ac.signal })).rejects.toThrow()
  })
})
