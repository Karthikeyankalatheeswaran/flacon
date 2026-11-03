import { FETCH_LIMITS, HostLimiter, checkFetchUrl, type FetchItem, type License, type Quality } from '@shared/fetch'
import type { FetchFn } from './download'

// Providers run only against sources that legitimately offer lossless downloads. They never touch the filesystem;
// they search, then resolve a hit into concrete downloadable files with their licence.

export interface SearchResult {
  provider: FetchItem['provider']
  /** Opaque id the same provider can resolve later. */
  id: string
  title: string
  artist: string
  license?: License
  /** Best encoding the item is known to hold, e.g. "24-bit FLAC" or "MP3". Shown so the choice is informed. */
  quality?: string
}

export interface ProviderCtx {
  fetchFn: FetchFn
  limiter: HostLimiter
  signal: AbortSignal
  /** What the user asked for; providers that offer several encodings honour it. Default: best. */
  quality?: Quality
  jamendoClientId?: string
  sleep?: (ms: number) => Promise<void>
}

export interface Provider {
  id: FetchItem['provider']
  name: string
  /** What the user is being offered, shown in the UI so nothing is a surprise. */
  blurb: string
  search(query: string, ctx: ProviderCtx): Promise<SearchResult[]>
  resolve(id: string, ctx: ProviderCtx): Promise<FetchItem[]>
}

export class ProviderError extends Error {}

async function getJson(url: string, ctx: ProviderCtx): Promise<unknown> {
  const c = checkFetchUrl(url)
  if (!c.ok) throw new ProviderError(c.reason)
  const wait = ctx.limiter.take(c.url.host)
  if (wait > 0) await (ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait)
  let res: Response
  try {
    res = await ctx.fetchFn(url, { headers: { 'User-Agent': FETCH_LIMITS.userAgent, Accept: 'application/json' }, signal: ctx.signal, redirect: 'manual' })
  } catch (e) {
    if (ctx.signal.aborted) throw e
    throw new ProviderError('Couldn’t reach the server. Check your connection and try again.')
  }
  if (res.status === 429) throw new ProviderError('The service asked us to slow down. Try again in a minute.')
  if (!res.ok) throw new ProviderError(`The service answered ${res.status}.`)
  try {
    return await res.json()
  } catch {
    throw new ProviderError('The service sent something unexpected.')
  }
}

/** "https://creativecommons.org/licenses/by-sa/4.0/" → { name: "CC BY-SA 4.0" }. Unknown licences are dropped, never guessed. */
export function parseLicense(url: string | undefined | null): License | undefined {
  if (!url) return undefined
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (!/(^|\.)creativecommons\.org$/.test(u.hostname)) return undefined
  const m = /\/licenses\/([a-z-]+)\/(\d\.\d)/.exec(u.pathname)
  if (m) return { name: `CC ${m[1]!.toUpperCase()} ${m[2]}`, url, attribution: m[1]!.includes('by') ? 'Attribution required' : undefined }
  if (/\/publicdomain\/zero\//.test(u.pathname)) return { name: 'CC0', url }
  // Old-style Internet Archive marker ("licenses/publicdomain/", no version): a real, common value.
  if (/\/licenses\/publicdomain\/?$/.test(u.pathname)) return { name: 'Public Domain', url }
  if (/\/publicdomain\/mark\//.test(u.pathname)) return { name: 'Public Domain', url }
  return undefined
}

const str = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '')
const enc = encodeURIComponent

export interface Candidate { name: string; group: string; lossless: boolean; score: number; format: string }

/** Rank one Internet Archive file by its format label. null = not music we offer (spectrograms, torrents, text…). */
export function archiveCandidate(f: Record<string, unknown>): Candidate | null {
  const label = str(f['format']).toLowerCase()
  const name = str(f['name'])
  if (!name || name.includes('..')) return null
  const group = (str(f['original']) || name).replace(/\.[^./]+$/, '')
  if (/flac/.test(label) && /\.flac$/i.test(name)) return { name, group, lossless: true, score: 1000 + (/24/.test(label) ? 50 : 0), format: 'flac' }
  if (/mp3/.test(label) && /\.mp3$/i.test(name)) {
    const br = /vbr/.test(label) ? 245 : Number(/(\d+)\s*kbps/.exec(label)?.[1]) || 128
    return { name, group, lossless: false, score: 300 + br / 4, format: 'mp3' } // 320 CBR ≈ 380, VBR ≈ 361, 128 ≈ 332
  }
  if (/ogg vorbis/.test(label) && /\.ogg$/i.test(name)) return { name, group, lossless: false, score: 200, format: 'ogg' }
  return null
}

/** One file per track, honouring the quality choice. Pure, so it is unit-tested. */
export function chooseFiles(cands: Candidate[], quality: Quality): Candidate[] {
  const by = new Map<string, Candidate[]>()
  for (const c of cands) by.set(c.group, [...(by.get(c.group) ?? []), c])
  const out: Candidate[] = []
  for (const list of by.values()) {
    const pool = quality === 'lossless' ? list.filter((c) => c.lossless) : quality === 'compact' ? list.filter((c) => !c.lossless) : list
    const pick = pool.sort((a, b) => b.score - a.score)[0]
    if (pick) out.push(pick)
  }
  return out
}

const QUALITY_HINT: Record<Quality, string> = { best: 'no audio files', lossless: 'no FLAC files (try “Best available”)', compact: 'no MP3 or Ogg files (try “Best available”)' }

const fold = (x: string): string => x.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'by', 'for', 'to'])

/** Words of a query, accent- and case-folded. Filler words are dropped unless they are all there is. */
export function queryTokens(query: string): string[] {
  const all = fold(query).replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const key = all.filter((t) => !STOP.has(t))
  return [...new Set(key.length ? key : all)].slice(0, 8)
}

const coverage = (tokens: string[], text: string): number => (tokens.length ? tokens.filter((t) => text.includes(t)).length / tokens.length : 0)

/** What an Internet Archive item is known to hold, from its list of file formats. */
export function archiveQualityLabel(formats: string[], quality: Quality = 'best'): { label: string; lossless: boolean } {
  const f = formats.join(' | ').toLowerCase()
  if (quality === 'compact') return /mp3/.test(f) ? { label: 'MP3', lossless: false } : /ogg/.test(f) ? { label: 'Ogg', lossless: false } : { label: '', lossless: false }
  if (/flac/.test(f)) return { label: /24/.test(f) ? '24-bit FLAC' : 'FLAC', lossless: true }
  if (/wave|\bwav\b|aiff/.test(f)) return { label: 'WAV', lossless: true }
  if (/mp3/.test(f)) return { label: 'MP3', lossless: false }
  if (/ogg/.test(f)) return { label: 'Ogg', lossless: false }
  return { label: '', lossless: false }
}

interface ArchiveDoc { id: string; title: string; creator: string; subject?: string; downloads: number; formats: string[]; license: License }

/** Order hits by how well they match the words typed, then by lossless availability and popularity. Pure, so unit-tested. */
export function rankArchive(docs: ArchiveDoc[], tokens: string[], quality: Quality, typed = tokens.join(' ')): Array<ArchiveDoc & { score: number }> {
  const words = (s: string): string => fold(s).replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const phrase = words(typed)
  return docs
    .map((d) => {
      const title = fold(d.title)
      const creator = fold(d.creator)
      const cov = Math.max(coverage(tokens, title), coverage(tokens, `${title} ${creator}`) * 0.9)
      const q = archiveQualityLabel(d.formats)
      const score =
        100 * coverage(tokens, title) + 60 * coverage(tokens, creator) + 40 * cov + (phrase && words(d.title).includes(phrase) ? 30 : 0) +
        20 * coverage(tokens, fold(d.subject ?? '')) + (quality !== 'compact' && q.lossless ? 70 : 0) + (quality !== 'compact' && q.label === '24-bit FLAC' ? 5 : 0) +
        6 * Math.log10(d.downloads + 1)
      return { ...d, score }
    })
    // With several words, most must be found: "kind of blue" should not return every item that merely says "blue".
    .filter((d) => coverage(tokens, `${fold(d.title)} ${fold(d.creator)} ${fold(d.subject ?? '')}`) >= (tokens.length > 1 ? Math.ceil(tokens.length * 0.6) / tokens.length : 0.01))
    .sort((a, b) => b.score - a.score)
}

export const archive: Provider = {
  id: 'archive',
  name: 'Internet Archive',
  blurb: 'Public-domain and Creative Commons audio. FLAC where the item has it, MP3 or Ogg otherwise.',
  async search(query, ctx) {
    const q = ctx.quality ?? 'best'
    const tokens = queryTokens(query)
    if (!tokens.length) return []
    const clause = q === 'lossless' ? ' AND format:FLAC' : q === 'compact' ? ' AND (format:"VBR MP3" OR format:"128Kbps MP3" OR format:"Ogg Vorbis")' : ''
    const base = ` AND mediatype:audio${clause} AND licenseurl:[* TO *]`
    // Every word must appear somewhere in the title, artist or subject.
    const allOf = (ts: string[]): string => ts.map((t) => `(title:${t} OR creator:${t} OR subject:${t})`).join(' AND ') + base
    const fetchDocs = async (text: string): Promise<ArchiveDoc[]> => {
      const j = (await getJson(`https://archive.org/advancedsearch.php?q=${enc(text)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=subject&fl[]=format&fl[]=downloads&rows=50&output=json`, ctx)) as { response?: { docs?: Array<Record<string, unknown>> } }
      return (j.response?.docs ?? []).flatMap((d) => {
        const license = parseLicense(str(d['licenseurl']))
        if (!license || !/^[\w.-]+$/.test(str(d['identifier']))) return [] // only items with a licence we understand
        const formats = Array.isArray(d['format']) ? d['format'].map(String) : []
        return [{ id: str(d['identifier']), title: str(d['title']) || str(d['identifier']), creator: str(d['creator']), subject: Array.isArray(d['subject']) ? d['subject'].join(' ') : str(d['subject']), downloads: Number(str(d['downloads'])) || 0, formats, license }]
      })
    }
    let docs = await fetchDocs(allOf(tokens))
    // Too few? Loosen gradually: first without year-like numbers (a year is rarely in the title), then with each single word dropped.
    const widen = async (ts: string[]): Promise<void> => {
      const seen = new Set(docs.map((d) => d.id))
      docs = [...docs, ...(await fetchDocs(allOf(ts))).filter((d) => !seen.has(d.id))]
    }
    const words = tokens.filter((t) => !/^\d+$/.test(t))
    if (docs.length < 8 && words.length && words.length < tokens.length) await widen(words)
    if (docs.length < 8 && words.length >= 3) for (let i = 0; i < Math.min(words.length, 5) && docs.length < 20; i++) await widen(words.filter((_, j) => j !== i))
    return rankArchive(docs, tokens, q, query).slice(0, 20).map((d) => ({ provider: 'archive' as const, id: d.id, title: d.title, artist: d.creator, license: d.license, quality: archiveQualityLabel(d.formats, q).label || undefined }))
  },
  async resolve(id, ctx) {
    if (!/^[\w.-]+$/.test(id)) throw new ProviderError('Bad item id.')
    const quality = ctx.quality ?? 'best'
    const j = (await getJson(`https://archive.org/metadata/${enc(id)}`, ctx)) as { metadata?: Record<string, unknown>; files?: Array<Record<string, unknown>> }
    const meta = j.metadata ?? {}
    const license = parseLicense(str(meta['licenseurl']))
    if (!license) throw new ProviderError('This item has no recognised licence, so it isn’t offered.')
    const files = j.files ?? []
    const chosen = chooseFiles(files.flatMap((f) => { const c = archiveCandidate(f); return c ? [c] : [] }), quality)
    if (!chosen.length) throw new ProviderError(`This item has ${QUALITY_HINT[quality]}.`)
    const info = new Map(files.map((f) => [str(f['name']), f]))
    return chosen.map((c) => {
      const f = info.get(c.name) ?? {}
      return {
        provider: 'archive' as const,
        title: str(f['title']) || c.name.replace(/\.[^./]+$/, ''),
        artist: str(f['creator']) || str(meta['creator']),
        album: str(meta['title']) || id,
        url: `https://archive.org/download/${enc(id)}/${c.name.split('/').map(enc).join('/')}`,
        format: c.format,
        size: Number(str(f['size'])) || 0,
        license
      }
    })
  }
}

const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
const AUDIO_EXT = /\.(flac|wav|aiff?|ogg|oga|opus|mp3)$/i
const LOSSLESS_EXT = /\.(flac|wav|aiff?)$/i

/** Wikimedia Commons: free audio with a licence on every file page (CC, public domain). Mostly Ogg; some FLAC/WAV. */
export const commons: Provider = {
  id: 'commons',
  name: 'Wikimedia Commons',
  blurb: 'Free-licence recordings from Wikimedia Commons (classical, field recordings, public domain). Mostly Ogg Vorbis; FLAC and WAV when uploaded.',
  async search(query, ctx) {
    return (await commonsHits(`generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch=${enc(`filetype:audio ${query.replace(/[^\p{L}\p{N}\s'-]/gu, ' ')}`)}`, ctx)).map((h) => ({ provider: 'commons' as const, id: h.title, title: h.name, artist: h.artist, license: h.license })).filter((_, i) => i < 20)
  },
  async resolve(id, ctx) {
    if (!/^File:[^|<>]{1,300}$/.test(id)) throw new ProviderError('Bad file id.')
    const [h] = await commonsHits(`titles=${enc(id)}`, ctx)
    if (!h) throw new ProviderError(`This file isn’t available at ${QUALITY_NAME[ctx.quality ?? 'best']} quality.`)
    return [{ provider: 'commons', title: h.name, artist: h.artist, album: 'Wikimedia Commons', url: h.url, format: h.ext, size: h.size, license: h.license }]
  }
}
const QUALITY_NAME: Record<Quality, string> = { best: 'this', lossless: 'lossless', compact: 'compact' }

async function commonsHits(sel: string, ctx: ProviderCtx): Promise<Array<{ title: string; name: string; artist: string; url: string; ext: string; size: number; license: License }>> {
  const j = (await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&${sel}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|ObjectName`, ctx)) as { query?: { pages?: Record<string, { index?: number; title?: string; imageinfo?: Array<Record<string, unknown>> }> } }
  const q = ctx.quality ?? 'best'
  return Object.values(j.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((p) => {
    const info = p.imageinfo?.[0]
    const title = p.title ?? ''
    if (!info || !AUDIO_EXT.test(title)) return []
    const lossless = LOSSLESS_EXT.test(title)
    if ((q === 'lossless' && !lossless) || (q === 'compact' && lossless)) return []
    const meta = (info['extmetadata'] ?? {}) as Record<string, { value?: string }>
    const short = stripHtml(meta['LicenseShortName']?.value ?? '')
    const license = parseLicense(meta['LicenseUrl']?.value) ?? (/^(public domain|pd\b|cc0)/i.test(short) ? { name: /^cc0/i.test(short) ? 'CC0' : 'Public Domain' } : undefined)
    const url = str(info['url'])
    const c = checkFetchUrl(url)
    if (!license || !c.ok || c.url.hostname !== 'upload.wikimedia.org') return [] // unknown licence or an unexpected host: never offered
    const file = title.replace(/^File:/, '')
    return [{ title, name: stripHtml(meta['ObjectName']?.value ?? '') || file.replace(/\.[^.]+$/, ''), artist: stripHtml(meta['Artist']?.value ?? ''), url, ext: file.slice(file.lastIndexOf('.') + 1).toLowerCase(), size: Number(info['size']) || 0, license }]
  })
}

export const jamendo: Provider = {
  id: 'jamendo',
  name: 'Jamendo',
  blurb: 'Creative Commons music from artists who allow downloads. Needs your own free Jamendo client ID.',
  async search(query, ctx) {
    if (!ctx.jamendoClientId) throw new ProviderError('Add your Jamendo client ID in Settings to search Jamendo.')
    const j = (await getJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${enc(ctx.jamendoClientId)}&format=json&limit=20&search=${enc(query)}&audiodlformat=${ctx.quality === 'compact' ? 'mp32' : 'flac'}&include=licenses`, ctx)) as { results?: Array<Record<string, unknown>> }
    return (j.results ?? []).flatMap((r) => {
      const license = parseLicense(str(r['license_ccurl']))
      if (!license || r['audiodownload_allowed'] !== true || !/^\d+$/.test(str(r['id']))) return []
      return [{ provider: 'jamendo' as const, id: `${str(r['id'])}|${str(r['audiodownload'])}|${str(r['album_name'])}`, title: str(r['name']), artist: str(r['artist_name']), license }]
    })
  },
  async resolve(id, ctx) {
    const [, url = '', album = ''] = id.split('|')
    const c = checkFetchUrl(url)
    if (!c.ok || !/(^|\.)jamendo\.com$/.test(c.url.hostname)) throw new ProviderError('Jamendo gave a download link we can’t use.')
    const hit = (await this.search(id.split('|')[0]!, ctx).catch(() => [])).find((r) => r.id === id)
    return [{ provider: 'jamendo', title: hit?.title ?? 'Jamendo track', artist: hit?.artist ?? '', album, url, format: ctx.quality === 'compact' ? 'mp3' : 'flac', size: 0, license: hit?.license }]
  }
}

/** "Paste link": a direct https link to a lossless file or ZIP the user is entitled to (e.g. a store's purchase download). */
export const link: Provider = {
  id: 'link',
  name: 'Paste link',
  blurb: 'A direct link to a FLAC/WAV file or a ZIP of them, such as a purchase download. Nothing is bypassed: the link must work on its own.',
  async search(query) {
    const c = checkFetchUrl(query)
    if (!c.ok) throw new ProviderError(c.reason)
    const name = decodeURIComponent(c.url.pathname.split('/').pop() || c.url.hostname)
    if (!/\.(flac|wav|aiff?|alac|m4a|ape|wv|zip)$/i.test(name)) throw new ProviderError('The link should end in .flac, .wav, .zip or another lossless format.')
    return [{ provider: 'link', id: c.url.toString(), title: name, artist: c.url.hostname }]
  },
  async resolve(id) {
    const c = checkFetchUrl(id)
    if (!c.ok) throw new ProviderError(c.reason)
    const name = decodeURIComponent(c.url.pathname.split('/').pop() || 'download')
    return [{ provider: 'link', title: name.replace(/\.\w+$/, ''), artist: '', album: '', url: c.url.toString(), format: name.split('.').pop()!.toLowerCase(), size: 0 }]
  }
}

export const PROVIDERS: Record<FetchItem['provider'], Provider> = { archive, commons, jamendo, link }
