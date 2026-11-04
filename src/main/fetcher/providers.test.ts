import { describe, expect, it } from 'vitest'
import { HostLimiter } from '@shared/fetch'
import type { FetchFn } from './download'
import { ccmixter, parseMixter, archive, archiveCandidate, archiveQualityLabel, chooseFiles, queryTokens, rankArchive, commons, jamendo, link, parseLicense, type Candidate, type ProviderCtx } from './providers'

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
    const r = await archive.search("good band", ctx(async () => json(search)))
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

describe('ccMixter', () => {
  const rec = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    upload_id: 25389, upload_name: 'Reverie', user_name: '_ghost', user_real_name: 'Ghost', license_url: 'https://creativecommons.org/licenses/by/3.0/',
    files: [{ file_name: 'r.mp3', download_url: 'https://ccmixter.org/content/_ghost/r.mp3', file_filesize: ' (1.57MB)', file_format_info: { 'default-ext': 'mp3' } }, { file_name: 'r.flac', download_url: 'https://ccmixter.org/content/_ghost/r.flac', file_filesize: ' (20.0MB)', file_format_info: { 'default-ext': 'flac' } }], ...o })
  it('offers items with a licence we understand and prefers lossless', async () => {
    const r = await ccmixter.search('reverie', ctx(async () => json([rec(), rec({ upload_id: 2, license_url: 'https://example.com/x' })])))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ provider: 'ccmixter', id: '25389', quality: 'FLAC', license: { name: 'CC BY 3.0' } })
  })
  it('drops files hosted anywhere but ccmixter.org, or that are not audio', () => {
    const hits = parseMixter([rec({ files: [{ download_url: 'https://evil.example/r.flac', file_format_info: { 'default-ext': 'flac' } }, { download_url: 'https://ccmixter.org/a.zip', file_format_info: { 'default-ext': 'zip' } }, { download_url: 'http://ccmixter.org/a.mp3', file_format_info: { 'default-ext': 'mp3' } }] })])
    expect(hits).toEqual([])
  })
  it('resolves to one file honouring the quality choice, and rejects hostile ids', async () => {
    const lossless = await ccmixter.resolve('25389', ctx(async () => json([rec()]), { quality: 'lossless' }))
    expect(lossless[0]).toMatchObject({ format: 'flac', size: 20e6, url: 'https://ccmixter.org/content/_ghost/r.flac' })
    const compact = await ccmixter.resolve('25389', ctx(async () => json([rec()]), { quality: 'compact' }))
    expect(compact[0]!.format).toBe('mp3')
    await expect(ccmixter.resolve('1;DROP', ctx(async () => json([])))).rejects.toThrow(/Bad item id/)
  })
  it('survives junk', async () => {
    expect(parseMixter({ not: 'an array' })).toEqual([])
    expect(await ccmixter.search('x', ctx(async () => json('<html>')))).toEqual([])
  })
})

describe('archive search relevance', () => {
  const lic = { name: 'CC0' }
  const doc = (id: string, title: string, creator: string, downloads: number, formats: string[]) => ({ id, title, creator, downloads, formats, license: lic })

  it('tokenises with accents, apostrophes and filler words handled', () => {
    expect(queryTokens("The Miles Davis — Kind of Blue")).toEqual(['miles', 'davis', 'kind', 'blue'])
    expect(queryTokens("Beyoncé it's")).toEqual(['beyonce', 'its'])
    expect(queryTokens('the of')).toEqual(['the', 'of']) // all filler: keep it rather than search for nothing
    expect(queryTokens('   ')).toEqual([])
  })
  it('labels what an item holds', () => {
    expect(archiveQualityLabel(['VBR MP3', '24bit Flac'])).toEqual({ label: '24-bit FLAC', lossless: true })
    expect(archiveQualityLabel(['Flac', 'Metadata']).label).toBe('FLAC')
    expect(archiveQualityLabel(['VBR MP3', 'Ogg Vorbis']).label).toBe('MP3')
    expect(archiveQualityLabel(['Metadata']).label).toBe('')
    expect(archiveQualityLabel(['Flac', 'VBR MP3'], 'compact').label).toBe('MP3') // Compact fetches the MP3, so that is what it says
  })
  it('puts title matches first, prefers lossless, and drops unrelated items', () => {
    const t = queryTokens('moonlight sonata')
    const r = rankArchive([
      doc('noise', 'Sermon 2010', 'St Aidans', 900, ['VBR MP3']),
      doc('mp3', 'Moonlight Sonata', 'Beethoven', 9000, ['VBR MP3']),
      doc('flac', 'Moonlight Sonata (Mv. 1)', 'Nils Johnson', 5000, ['Flac']),
      doc('half', 'Moonlight Serenade', 'Glenn Miller', 100, ['Flac'])
    ], t, 'best').map((x) => x.id)
    expect(r[0]).toBe('flac')
    expect(r).toContain('mp3')
    expect(r).not.toContain('noise')
    expect(r).not.toContain('half') // only one of the two words matches
  })
  it('keeps subject-only matches for a one-word genre search', () => {
    const r = rankArchive([{ ...doc('a', 'KXJZ 1/1/11', 'Gary V', 50, ['VBR MP3']), subject: 'jazz; radio' }, doc('b', 'Sermon', 'X', 5, [])], queryTokens('jazz'), 'best')
    expect(r.map((x) => x.id)).toEqual(['a'])
  })
  it('does not reward lossless when the user asked for compact', () => {
    const t = queryTokens('blue')
    const r = rankArchive([doc('flac', 'Blue', 'A', 10, ['Flac']), doc('mp3', 'Blue', 'A', 5000, ['VBR MP3'])], t, 'compact').map((x) => x.id)
    expect(r[0]).toBe('mp3')
  })
  it('searches with every word required, then loosens when little is found', async () => {
    const urls: string[] = []
    const fn: FetchFn = async (u) => { urls.push(String(u)); return json({ response: { docs: [] } }) }
    await archive.search('miles davis blue', ctx(fn))
    expect(urls).toHaveLength(4) // all three words, then each single word dropped in turn
    expect(decodeURIComponent(urls[0]!)).toContain('(title:miles OR creator:miles OR subject:miles) AND (title:davis')
    expect(decodeURIComponent(urls[1]!)).not.toContain('title:miles') // "miles" dropped
    urls.length = 0
    await archive.search('jazz', ctx(fn))
    expect(urls).toHaveLength(1) // one word: nothing looser to try
    urls.length = 0
    await archive.search('charleston fox trot 1925', ctx(fn))
    expect(decodeURIComponent(urls[1]!)).not.toContain('1925') // second try drops the year
    expect(decodeURIComponent(urls[1]!)).toContain('title:trot')
  })
})
