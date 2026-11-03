import { describe, expect, it } from 'vitest'
import { FETCH_LIMITS, HostLimiter, backoffMs, checkFetchUrl, checkZipEntry, isPrivateHost, nextRunnable, recoverJobs, renderTemplate, sanitizeSegment, uniquePath, type FetchJob } from './fetch'

const job = (id: string, over: Partial<FetchJob> = {}): FetchJob => ({
  id, status: 'queued', received: 0, total: 0, attempt: 0, retryAt: 0, error: null, notes: [], createdAt: Number(id),
  item: { provider: 'link', title: 't', artist: '', album: '', url: 'https://example.com/a.flac', format: 'flac', size: 0 }, ...over
})

describe('urls', () => {
  it('accepts plain https and rejects http, credentials and junk', () => {
    expect(checkFetchUrl('https://archive.org/download/x/y.flac').ok).toBe(true)
    expect(checkFetchUrl('http://archive.org/x').ok).toBe(false)
    expect(checkFetchUrl('https://user:pw@example.com/x').ok).toBe(false)
    expect(checkFetchUrl('file:///etc/passwd').ok).toBe(false)
    expect(checkFetchUrl('not a url').ok).toBe(false)
  })
  it('blocks loopback, private and link-local targets', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.1.1', '169.254.169.254', '[::1]', 'fd00::1', 'printer.local', '::ffff:10.0.0.1'])
      expect(isPrivateHost(h), h).toBe(true)
    for (const h of ['archive.org', '8.8.8.8', '172.32.0.1']) expect(isPrivateHost(h), h).toBe(false)
    expect(checkFetchUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false)
  })
})

describe('filenames', () => {
  it('strips illegal characters, reserved names, trailing dots and normalizes to NFC', () => {
    expect(sanitizeSegment('AC/DC: Back In Black?')).toBe('AC_DC_ Back In Black_')
    expect(sanitizeSegment('CON')).toBe('_CON')
    expect(sanitizeSegment('nul.txt')).toBe('_nul.txt')
    expect(sanitizeSegment('Album... ')).toBe('Album')
    expect(sanitizeSegment('')).toBe('_')
    expect(sanitizeSegment('..hidden')).toBe('_hidden')
    expect(sanitizeSegment('e\u0301')).toBe('\u00e9')
  })
  it('truncates long names with a stable hash suffix, never splitting a character', () => {
    const long = '字'.repeat(200)
    const a = sanitizeSegment(long)
    expect(Buffer.byteLength(a)).toBeLessThanOrEqual(120)
    expect(a).toBe(sanitizeSegment(long))
    expect(a).toMatch(/~[0-9a-f]{8}$/)
    expect(sanitizeSegment('字'.repeat(201))).not.toBe(a)
  })
  it('renders the default template and collapses missing fields', () => {
    const t = { albumartist: 'Salt & Ember', album: 'Pilot Light', year: 2019, disc: 1, track: 3, title: 'Hush', ext: 'FLAC' }
    expect(renderTemplate('{albumartist}/{album} ({year})/{disc}-{track} {title}', t)).toEqual(['Salt & Ember', 'Pilot Light (2019)', '03 Hush.flac'])
    expect(renderTemplate('{albumartist}/{album} ({year})/{disc}-{track} {title}', { ...t, year: null, disc: 2 })[1]).toBe('Pilot Light')
    expect(renderTemplate('{albumartist}/{album} ({year})/{disc}-{track} {title}', { ...t, disc: 2 })[2]).toBe('2-03 Hush.flac')
    expect(renderTemplate('{albumartist}/{title}', { ...t, albumartist: '', title: 'a/b' })).toEqual(['Unknown Artist', 'a_b.flac'])
  })
  it('resolves case-insensitive collisions', () => {
    const taken = new Set<string>()
    expect(uniquePath('A/Song.flac', taken)).toBe('A/Song.flac')
    expect(uniquePath('A/song.FLAC', taken)).toBe('A/song (2).FLAC')
    expect(uniquePath('A/SONG.flac', taken)).toBe('A/SONG (3).flac')
  })
})

describe('zip entries', () => {
  const e = (name: string, size = 1000, compressed = 900) => checkZipEntry({ name, size, compressed })
  it('rejects zip-slip and absolute paths', () => {
    for (const n of ['../evil.flac', 'a/../../evil.flac', '/etc/x.flac', 'C:\\x.flac', '..\\x.flac', 'a\\..\\..\\x.flac'])
      expect(e(n), n).toEqual({ keep: false, reason: 'unsafe' })
  })
  it('keeps only audio, artwork, cue and log files', () => {
    expect(e('Album/01 Track.flac')).toEqual({ keep: true, rel: 'Album/01 Track.flac' })
    expect(e('Album/cover.JPG').keep).toBe(true)
    expect(e('Album/album.cue').keep).toBe(true)
    expect(e('Album/setup.exe')).toEqual({ keep: false, reason: 'ignored' })
    expect(e('__MACOSX/._x.flac')).toEqual({ keep: false, reason: 'ignored' })
    expect(e('Album/')).toEqual({ keep: false, reason: 'ignored' })
  })
  it('rejects huge and bomb-like entries', () => {
    expect(e('a.flac', FETCH_LIMITS.maxEntryBytes + 1)).toEqual({ keep: false, reason: 'too-big' })
    expect(e('a.wav', 500 * 1024 ** 2, 1000)).toEqual({ keep: false, reason: 'ratio' })
  })
})

describe('scheduling', () => {
  it('backoff grows, is capped and jittered within [cap/2, cap]', () => {
    expect(backoffMs(0, 0)).toBe(500)
    expect(backoffMs(0, 1)).toBe(1000)
    expect(backoffMs(3, 1)).toBe(8000)
    expect(backoffMs(30, 1)).toBe(60000)
    expect(backoffMs(30, 0)).toBe(30000)
  })
  it('limits per host without blocking other hosts', () => {
    let t = 0
    const l = new HostLimiter(1000, () => t)
    expect(l.take('a.org')).toBe(0)
    expect(l.take('a.org')).toBe(1000)
    expect(l.take('a.org')).toBe(2000)
    expect(l.take('b.org')).toBe(0)
    t = 5000
    expect(l.take('a.org')).toBe(0)
  })
  it('starts at most `limit` jobs, FIFO, honouring backoff and skipping paused', () => {
    const jobs = [job('1', { status: 'downloading' }), job('2'), job('3', { retryAt: 9999 }), job('4', { status: 'paused' }), job('5')]
    expect(nextRunnable(jobs, 100, 3).map((j) => j.id)).toEqual(['2', '5'])
    expect(nextRunnable(jobs, 10000, 3).map((j) => j.id)).toEqual(['2', '3'])
    expect(nextRunnable([job('1', { status: 'downloading' }), job('2', { status: 'verifying' }), job('3', { status: 'importing' }), job('4')], 0)).toEqual([])
  })
  it('recovers in-flight jobs as queued after a restart and keeps paused/done as they were', () => {
    const r = recoverJobs([job('1', { status: 'downloading', received: 500 }), job('2', { status: 'paused' }), job('3', { status: 'done' })])
    expect(r.map((j) => j.status)).toEqual(['queued', 'paused', 'done'])
    expect(r[0]!.received).toBe(500)
  })
})
