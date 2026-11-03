import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { parseFile } from 'music-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FetchItem, FetchJob } from '@shared/fetch'
import type { FetchFn } from './download'
import { FetchManager } from './manager'

const ff = ffmpegPath as string
const root = mkdtempSync(join(tmpdir(), 'flacon-mgr-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const tone = (out: string, tags: Record<string, string>, hz = 440): void =>
  void execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${hz}:d=3:r=44100`, '-sample_fmt', 's16', ...Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), out])

let tagged: Buffer, untagged: Buffer, corrupt: Buffer, zipBuf: Buffer
beforeAll(() => {
  tone(join(root, 't.flac'), { title: 'Hush', artist: 'Salt & Ember', album: 'Pilot Light', track: '3', date: '2019' })
  tone(join(root, 'u.flac'), {}, 330)
  tone(join(root, 'z1.flac'), { title: 'One', artist: 'Zed', album: 'Zip Album', track: '1' }, 220)
  tone(join(root, 'z2.flac'), { title: 'Two', artist: 'Zed', album: 'Zip Album', track: '2' }, 261)
  writeFileSync(join(root, 'cover.jpg'), 'JPEGDATA')
  tagged = readFileSync(join(root, 't.flac'))
  untagged = readFileSync(join(root, 'u.flac'))
  corrupt = Buffer.from(tagged)
  const at = Math.floor(corrupt.length * 0.6)
  for (let i = at; i < at + 40; i++) corrupt[i] = corrupt[i]! ^ 0xff
  const py = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nfor n in ['z1.flac','z2.flac','cover.jpg']:\n  z.write(sys.argv[2]+'/'+n, 'Zip Album/'+n)\nz.write(sys.argv[2]+'/cover.jpg','../evil.flac') if False else None\nz.close()`
  execFileSync('python3', ['-I', '-c', py, join(root, 'a.zip'), root])
  zipBuf = readFileSync(join(root, 'a.zip'))
}, 60000)

const item = (url: string, extra: Partial<FetchItem> = {}): FetchItem => ({ provider: 'link', title: 'Fallback Title', artist: 'Fallback Artist', album: 'Fallback Album', url, format: 'flac', size: 0, ...extra })

function make(files: Record<string, Buffer | number>, tag: string, opts: { gate?: Promise<void> } = {}) {
  const dir = join(root, tag)
  const log: FetchJob[][] = []
  const calls: Array<{ url: string; range?: string }> = []
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, range: init.headers['Range'] })
    const f = files[url]
    if (typeof f === 'number') return new Response('err', { status: f })
    if (!f) return new Response('nope', { status: 404 })
    const m = /bytes=(\d+)-/.exec(init.headers['Range'] ?? '')
    const start = m ? Number(m[1]) : 0
    const body = f.subarray(start)
    const headers = { 'content-length': String(body.length) }
    if (!opts.gate || start > 0) return new Response(new Uint8Array(body), { status: start ? 206 : 200, headers })
    // Streams the first 1000 bytes, then stalls until aborted (to exercise pause/cancel mid-download).
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(body.subarray(0, 1000)); init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')), { once: true }) }
    })
    return new Response(stream, { status: 200, headers })
  }
  const m = new FetchManager({
    dir, libraryRoot: join(dir, 'Library'), jobsFile: join(dir, 'jobs.json'), fetchFn, ffmpeg: ff, onChange: (j) => log.push(j.map((x) => ({ ...x }))),
    sleep: async () => {}, freeBytes: async () => 50 * 1024 ** 3, rand: () => 0, concurrency: 3
  })
  return { m, dir, calls, lib: join(dir, 'Library') }
}
const until = async (f: () => boolean, ms = 8000): Promise<void> => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)) } }
const ls = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String).sort() : [])

describe('FetchManager', () => {
  it('downloads, verifies, tags the licence, renames by template and cleans staging', async () => {
    const { m, lib, dir } = make({ 'https://x.org/t.flac': tagged }, 'happy')
    m.enqueue([item('https://x.org/t.flac', { license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Attribution required' } })])
    await until(() => m.list()[0]!.status === 'done')
    expect(ls(lib)).toEqual(['Salt & Ember', 'Salt & Ember/Pilot Light (2019)', 'Salt & Ember/Pilot Light (2019)/03 Hush.flac'])
    const meta = (await parseFile(join(lib, 'Salt & Ember/Pilot Light (2019)/03 Hush.flac'))).common
    expect(meta.title).toBe('Hush')
    expect(meta.copyright).toMatch(/CC BY 4\.0/)
    expect(ls(join(dir, 'incoming'))).toEqual([])
    expect(m.list()[0]!.notes.join(' ')).toMatch(/No checksum|^$/)
  }, 30000)

  it('fills missing tags from the source metadata', async () => {
    const { m, lib } = make({ 'https://x.org/u.flac': untagged }, 'fill')
    m.enqueue([item('https://x.org/u.flac', { title: 'Found Song', artist: 'Found Artist', album: 'Found Album' })])
    await until(() => m.list()[0]!.status === 'done')
    expect(ls(lib).at(-1)).toBe('Found Artist/Found Album/Found Song.flac')
  }, 30000)

  it('extracts a ZIP, imports every track and carries the cover along', async () => {
    const { m, lib } = make({ 'https://x.org/a.zip': zipBuf }, 'zip')
    m.enqueue([item('https://x.org/a.zip', { format: 'zip' })])
    await until(() => m.list()[0]!.status === 'done')
    expect(ls(lib).filter((p) => /\.(flac|jpg)$/.test(p))).toEqual(['Zed/Zip Album/01 One.flac', 'Zed/Zip Album/02 Two.flac', 'Zed/Zip Album/cover.jpg'])
  }, 30000)

  it('retries transient failures with backoff, then succeeds', async () => {
    let n = 0
    const base = make({ 'https://x.org/t.flac': tagged }, 'retry')
    const inner = (base.m as unknown as { d: { fetchFn: FetchFn } }).d.fetchFn
    ;(base.m as unknown as { d: { fetchFn: FetchFn } }).d.fetchFn = async (u, i) => (n++ < 2 ? new Response('busy', { status: 503 }) : inner(u, i))
    base.m.enqueue([item('https://x.org/t.flac')])
    await until(() => base.m.list()[0]!.status === 'done', 15000)
    expect(n).toBeGreaterThanOrEqual(3)
  }, 30000)

  it('fails permanently on 404 without retrying', async () => {
    const { m, calls } = make({}, 'notfound')
    m.enqueue([item('https://x.org/missing.flac')])
    await until(() => m.list()[0]!.status === 'failed')
    expect(m.list()[0]!.error).toMatch(/refused/)
    expect(calls).toHaveLength(1)
  })

  it('rejects a corrupt file and imports nothing', async () => {
    const { m, lib } = make({ 'https://x.org/c.flac': corrupt }, 'corrupt')
    m.enqueue([item('https://x.org/c.flac')])
    await until(() => m.list()[0]!.status === 'failed')
    expect(m.list()[0]!.error).toMatch(/damaged|corrupt|checksum|Decoding/i)
    expect(ls(lib)).toEqual([])
  }, 30000)

  it('pauses mid-download keeping the .part, then resumes with a Range request', async () => {
    const { m, calls, lib } = make({ 'https://x.org/t.flac': tagged }, 'pause', { gate: Promise.resolve() })
    m.enqueue([item('https://x.org/t.flac')])
    await until(() => m.list()[0]!.received >= 1000)
    m.pause(m.list()[0]!.id)
    await until(() => m.list()[0]!.status === 'paused')
    m.resume(m.list()[0]!.id)
    await until(() => m.list()[0]!.status === 'done')
    expect(calls[1]!.range).toBe('bytes=1000-')
    expect(ls(lib).some((p) => p.endsWith('Hush.flac'))).toBe(true)
  }, 30000)

  it('cancels mid-download and removes the partial data', async () => {
    const { m, dir } = make({ 'https://x.org/t.flac': tagged }, 'cancel', { gate: Promise.resolve() })
    m.enqueue([item('https://x.org/t.flac')])
    await until(() => m.list()[0]!.received >= 1000)
    m.cancel(m.list()[0]!.id)
    await until(() => m.list()[0]!.status === 'canceled')
    await m.idle()
    expect(ls(join(dir, 'incoming'))).toEqual([])
  }, 30000)

  it('runs at most 3 downloads at once', async () => {
    const files: Record<string, Buffer> = {}
    for (let i = 0; i < 5; i++) files[`https://x.org/${i}.flac`] = tagged
    const { m } = make(files, 'conc', { gate: Promise.resolve() })
    m.enqueue(Array.from({ length: 5 }, (_, i) => item(`https://x.org/${i}.flac`)))
    await until(() => m.list().filter((j) => j.status === 'downloading' && j.received >= 1000).length === 3)
    await new Promise((r) => setTimeout(r, 200))
    expect(m.list().filter((j) => j.status === 'downloading')).toHaveLength(3)
    expect(m.list().filter((j) => j.status === 'queued')).toHaveLength(2)
    m.stop()
  }, 30000)

  it('notices a duplicate already in the library', async () => {
    const { m } = make({ 'https://x.org/t.flac': tagged }, 'dup')
    m.enqueue([item('https://x.org/t.flac')])
    await until(() => m.list()[0]!.status === 'done')
    m.enqueue([item('https://x.org/t.flac')])
    await until(() => m.list()[1]!.status === 'done')
    expect(m.list()[1]!.notes.join(' ')).toMatch(/Already in your library/)
  }, 30000)

  it('persists the queue and recovers in-flight jobs as queued after a restart', async () => {
    const { m, dir, lib } = make({ 'https://x.org/t.flac': tagged }, 'persist', { gate: Promise.resolve() })
    m.enqueue([item('https://x.org/t.flac')])
    await until(() => m.list()[0]!.received >= 1000)
    await m.save()
    const saved = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8')) as FetchJob[]
    expect(saved[0]!.status).toBe('downloading')
    m.stop()
    const m2 = new FetchManager({ dir, libraryRoot: lib, jobsFile: join(dir, 'jobs.json'), ffmpeg: ff, onChange: () => {}, sleep: async () => {}, freeBytes: async () => 50 * 1024 ** 3,
      fetchFn: async (_u, init) => { const s = /bytes=(\d+)-/.exec(init.headers['Range'] ?? ''); const b = tagged.subarray(s ? Number(s[1]) : 0); return new Response(new Uint8Array(b), { status: s ? 206 : 200, headers: { 'content-length': String(b.length) } }) } })
    await m2.load()
    await until(() => m2.list()[0]!.status === 'done')
  }, 30000)
})
