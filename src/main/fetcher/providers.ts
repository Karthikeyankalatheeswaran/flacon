import { FETCH_LIMITS, HostLimiter, checkFetchUrl, type FetchItem, type License } from '@shared/fetch'
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
}

export interface ProviderCtx {
  fetchFn: FetchFn
  limiter: HostLimiter
  signal: AbortSignal
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

export const archive: Provider = {
  id: 'archive',
  name: 'Internet Archive',
  blurb: 'Public-domain and Creative Commons audio that has FLAC files.',
  async search(query, ctx) {
    const q = `(${query.replace(/[^\p{L}\p{N}\s'-]/gu, ' ')}) AND mediatype:audio AND format:FLAC AND licenseurl:[* TO *]`
    const j = (await getJson(`https://archive.org/advancedsearch.php?q=${enc(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=20&output=json`, ctx)) as { response?: { docs?: Array<Record<string, unknown>> } }
    return (j.response?.docs ?? []).flatMap((d) => {
      const license = parseLicense(str(d['licenseurl']))
      if (!license || !/^[\w.-]+$/.test(str(d['identifier']))) return [] // only items with a licence we understand
      return [{ provider: 'archive' as const, id: str(d['identifier']), title: str(d['title']) || str(d['identifier']), artist: str(d['creator']), license }]
    })
  },
  async resolve(id, ctx) {
    if (!/^[\w.-]+$/.test(id)) throw new ProviderError('Bad item id.')
    const j = (await getJson(`https://archive.org/metadata/${enc(id)}`, ctx)) as { metadata?: Record<string, unknown>; files?: Array<Record<string, unknown>> }
    const meta = j.metadata ?? {}
    const license = parseLicense(str(meta['licenseurl']))
    if (!license) throw new ProviderError('This item has no recognised licence, so it isn’t offered.')
    const flacs = (j.files ?? []).filter((f) => str(f['format']).toLowerCase() === 'flac' && /\.flac$/i.test(str(f['name'])))
    if (!flacs.length) throw new ProviderError('This item has no FLAC files.')
    return flacs.map((f) => ({
      provider: 'archive' as const,
      title: str(f['title']) || str(f['name']).replace(/\.flac$/i, ''),
      artist: str(f['creator']) || str(meta['creator']),
      album: str(meta['title']) || id,
      url: `https://archive.org/download/${enc(id)}/${str(f['name']).split('/').map(enc).join('/')}`,
      format: 'flac',
      size: Number(str(f['size'])) || 0,
      license
    }))
  }
}

export const jamendo: Provider = {
  id: 'jamendo',
  name: 'Jamendo',
  blurb: 'Creative Commons music from artists who allow downloads. Needs your own free Jamendo client ID.',
  async search(query, ctx) {
    if (!ctx.jamendoClientId) throw new ProviderError('Add your Jamendo client ID in Settings to search Jamendo.')
    const j = (await getJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${enc(ctx.jamendoClientId)}&format=json&limit=20&search=${enc(query)}&audiodlformat=flac&include=licenses`, ctx)) as { results?: Array<Record<string, unknown>> }
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
    return [{ provider: 'jamendo', title: hit?.title ?? 'Jamendo track', artist: hit?.artist ?? '', album, url, format: 'flac', size: 0, license: hit?.license }]
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

export const PROVIDERS: Record<FetchItem['provider'], Provider> = { archive, jamendo, link }
