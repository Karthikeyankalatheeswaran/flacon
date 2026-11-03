import { describe, expect, it } from 'vitest'
import { HostLimiter } from '@shared/fetch'
import type { FetchFn } from './download'
import { archive, archiveCandidate, chooseFiles, commons, jamendo, link, parseLicense, type Candidate, type ProviderCtx } from './providers'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
const ctx = (fn: FetchFn, extra: Partial<ProviderCtx> = {}): ProviderCtx => ({ fetchFn: fn, limiter: new HostLimiter(0), signal: new AbortController().signal, sleep: async () => {}, ...extra })

describe('licences', () => {
  it('names Creative Commons and public-domain licences, drops everything else', () => {
    expect(parseLicense('https://creativecommons.org/licenses/by-sa/4.0/')).toMatchObject({ name: 'CC BY-SA 4.0' })
    expect(parseLicense('http://creativecommons.org/licenses/by-nc-nd/3.0/us/')).toMatchObject({ name: 'CC BY-NC-ND 3.0' })
    expect(parseLicense('http://creativecommons.org/licenses/publicdomain/')).toMatchObject({ name: 'Public Domain' })
    expect(parseLicense('https://creativecommons.org/publicdomain/zero/1.0/')).toEqual({ name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' })
    expect(parseLicense('https://example.com/licenses/by/4.0/')).toBeUndefined()
    expect(parseLicense('')).toBeUndefined()
    expect(parseLicense('garbage')).toBeUndefined()
  })
})

describe('archive.org', () => {
  const search = { response: { docs: [
    { identifier: 'good-album', title: 'Good Album', creator: 'The Band', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
    { identifier: 'no-license', title: 'Unlicensed', creator: 'X', licenseurl: 'https://example.com/all-rights-reserved' },
    { identifier: 'bad id!', title: 'Weird', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }
  ] } }
  it('lists only items with a licence we understand and a safe identifier', async () => {
    const r = await archive.search("it's a band", ctx(async () => json(search)))
    expect(r.map((x) => x.id)).toEqual(['good-album'])
    expect(r[0]!.license!.name).toBe('CC BY 4.0')
  })
  it('resolves to FLAC files only, with encoded download URLs and the licence', async () => {
    const meta = { metadata: { title: 'Good Album', creator: 'The Band', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }, files: [
      { name: 'a b/01 One.flac', format: 'Flac', size: '1234', title: 'One' }, { name: '01 One.mp3', format: 'VBR MP3' }, { name: 'cover.jpg', format: 'JPEG' } ] }
    const items = await archive.resolve('good-album', ctx(async () => json(meta), { quality: 'lossless' }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ url: 'https://archive.org/download/good-album/a%20b/01%20One.flac', size: 1234, album: 'Good Album', license: { name: 'CC BY 4.0' } })
  })
  it('refuses items with no licence or no FLAC', async () => {
    await expect(archive.resolve('x', ctx(async () => json({ metadata: {}, files: [] })))).rejects.toThrow(/licence/)
    await expect(archive.resolve('x', ctx(async () => json({ metadata: { licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' }, files: [] }), { quality: 'lossless' }))).rejects.toThrow(/no FLAC/)
  })
  it('turns network failure, 429 and bad JSON into friendly errors', async () => {
    await expect(archive.search('a', ctx(async () => { throw new TypeError('fetch failed') }))).rejects.toThrow(/connection/)
    await expect(archive.search('a', ctx(async () => json({}, 429)))).rejects.toThrow(/slow down/)
    await expect(archive.search('a', ctx(async () => new Response('<html>', { status: 200 })))).rejects.toThrow(/unexpected/)
  })
})

describe('jamendo', () => {
  it('needs a client ID', async () => {
    await expect(jamendo.search('x', ctx(async () => json({})))).rejects.toThrow(/client ID/)
  })
  it('keeps only licensed, download-allowed tracks', async () => {
    const body = { results: [
      { id: '1', name: 'Song', artist_name: 'Art', album_name: 'Alb', audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1/flac/', audiodownload_allowed: true, license_ccurl: 'https://creativecommons.org/licenses/by-nc/3.0/' },
      { id: '2', name: 'Blocked', audiodownload_allowed: false, license_ccurl: 'https://creativecommons.org/licenses/by/3.0/' } ] }
    const r = await jamendo.search('x', ctx(async () => json(body), { jamendoClientId: 'abc' }))
    expect(r).toHaveLength(1)
    expect(r[0]!.license!.name).toBe('CC BY-NC 3.0')
  })
  it('rejects a download link that is not on jamendo.com', async () => {
    await expect(jamendo.resolve('1|https://evil.example.com/x|Alb', ctx(async () => json({})))).rejects.toThrow(/can’t use/)
  })
})

describe('paste link', () => {
  it('accepts a direct lossless link', async () => {
    const r = await link.search('https://store.example.com/dl/My%20Album.zip', ctx(async () => json({})))
    expect(r[0]).toMatchObject({ title: 'My Album.zip', id: 'https://store.example.com/dl/My%20Album.zip' })
    expect((await link.resolve(r[0]!.id, ctx(async () => json({}))))[0]).toMatchObject({ format: 'zip', title: 'My Album' })
  })
  it('rejects http, local addresses and non-audio links with a reason', async () => {
    await expect(link.search('http://a.com/x.flac', ctx(async () => json({})))).rejects.toThrow(/https/)
    await expect(link.search('https://192.168.1.5/x.flac', ctx(async () => json({})))).rejects.toThrow(/local/)
    await expect(link.search('https://a.com/page.html', ctx(async () => json({})))).rejects.toThrow(/lossless/)
    await expect(link.search('hello', ctx(async () => json({})))).rejects.toThrow(/link/)
  })
})

describe('quality choice', () => {
  const files = [
    { name: 't1.flac', format: 'Flac', original: 't1.wav' }, { name: 't1_vbr.mp3', format: 'VBR MP3', original: 't1.wav' }, { name: 't1_64kb.mp3', format: '64Kbps MP3', original: 't1.wav' },
    { name: 't2_vbr.mp3', format: 'VBR MP3', original: 't2.wav' }, { name: 't2.ogg', format: 'Ogg Vorbis', original: 't2.wav' }, { name: 'cover.jpg', format: 'JPEG' }
  ]
  const cands = files.flatMap((f) => archiveCandidate(f) ?? []) as Candidate[]
  it('best: lossless where a track has it, else the best lossy', () => {
    expect(chooseFiles(cands, 'best').map((c) => c.name).sort()).toEqual(['t1.flac', 't2_vbr.mp3'])
  })
  it('lossless: only FLAC, tracks without it are skipped', () => {
    expect(chooseFiles(cands, 'lossless').map((c) => c.name)).toEqual(['t1.flac'])
  })
  it('compact: prefers VBR MP3 over low-bitrate MP3 and Ogg, never FLAC', () => {
    expect(chooseFiles(cands, 'compact').map((c) => c.name).sort()).toEqual(['t1_vbr.mp3', 't2_vbr.mp3'])
  })
  it('archive.resolve reports a clear reason when the quality has nothing', async () => {
    const meta = { metadata: { licenseurl: 'https://creativecommons.org/licenses/by/4.0/', title: 'A' }, files: [{ name: 'a_vbr.mp3', format: 'VBR MP3' }] }
    await expect(archive.resolve('item', ctx(async () => json(meta), { quality: 'lossless' }))).rejects.toThrow(/no FLAC/)
    const ok = await archive.resolve('item', ctx(async () => json(meta), { quality: 'best' }))
    expect(ok[0]).toMatchObject({ format: 'mp3' })
  })
})

describe('wikimedia commons', () => {
  const page = (title: string, license: Record<string, string>, host = 'upload.wikimedia.org') => ({ title, index: 1, imageinfo: [{ url: `https://${host}/x/${encodeURIComponent(title)}`, size: 1000, extmetadata: { ...Object.fromEntries(Object.entries(license).map(([k, v]) => [k, { value: v }])), Artist: { value: '<a href="x">Ann &amp; Bo</a>' }, ObjectName: { value: 'Prelude' } } }] })
  const body = { query: { pages: {
    '1': page('File:a.ogg', { LicenseShortName: 'CC BY-SA 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' }),
    '2': page('File:b.flac', { LicenseShortName: 'Public domain' }),
    '3': page('File:c.ogg', { LicenseShortName: 'All rights reserved' }),
    '4': page('File:d.ogg', { LicenseShortName: 'CC0' }, 'evil.example.com'),
    '5': page('File:e.jpg', { LicenseShortName: 'CC0' })
  } } }
  it('lists only audio with a known licence on the expected host, with clean credits', async () => {
    const r = await commons.search('bach', ctx(async () => json(body)))
    expect(r.map((x) => x.id).sort()).toEqual(['File:a.ogg', 'File:b.flac'])
    expect(r.find((x) => x.id === 'File:a.ogg')).toMatchObject({ title: 'Prelude', artist: 'Ann & Bo', license: { name: 'CC BY-SA 4.0' } })
  })
  it('quality filters by encoding', async () => {
    expect((await commons.search('x', ctx(async () => json(body), { quality: 'lossless' }))).map((x) => x.id)).toEqual(['File:b.flac'])
    expect((await commons.search('x', ctx(async () => json(body), { quality: 'compact' }))).map((x) => x.id)).toEqual(['File:a.ogg'])
  })
  it('rejects malformed ids', async () => {
    await expect(commons.resolve('https://evil', ctx(async () => json(body)))).rejects.toThrow(/Bad file id/)
  })
})
