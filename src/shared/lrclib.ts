import { z } from 'zod'
import { parseLyrics, type Lyrics } from './lyrics'

/** LRCLIB (https://lrclib.net): a free, open lyrics database. Only artist, title, album and length are sent. */
export const LRCLIB_HOST = 'lrclib.net'

export interface LyricsQuery { artist: string; title: string; album: string; durationSec: number }

export function lrclibUrl(q: LyricsQuery): string | null {
  const title = q.title.trim()
  const artist = q.artist.trim()
  if (!title || !artist || !(q.durationSec > 0)) return null
  const u = new URL(`https://${LRCLIB_HOST}/api/get`)
  u.searchParams.set('track_name', title.slice(0, 200))
  u.searchParams.set('artist_name', artist.slice(0, 200))
  if (q.album.trim()) u.searchParams.set('album_name', q.album.trim().slice(0, 200))
  u.searchParams.set('duration', String(Math.round(q.durationSec)))
  return u.toString()
}

const Reply = z.object({
  instrumental: z.boolean().optional(),
  plainLyrics: z.string().max(200_000).nullish(),
  syncedLyrics: z.string().max(200_000).nullish()
})

export type LrclibResult = { kind: 'lyrics'; lrc: string; lyrics: Lyrics } | { kind: 'instrumental' } | { kind: 'none' }

/** Untrusted JSON in, text we can store out. Synced lyrics win over plain ones. */
export function pickLrclib(json: unknown): LrclibResult {
  const r = Reply.safeParse(json)
  if (!r.success) return { kind: 'none' }
  if (r.data.instrumental) return { kind: 'instrumental' }
  for (const raw of [r.data.syncedLyrics, r.data.plainLyrics]) {
    if (!raw) continue
    const lyrics = parseLyrics(raw, 'online')
    if (lyrics) return { kind: 'lyrics', lrc: raw, lyrics }
  }
  return { kind: 'none' }
}

/** A cache file name for one recording; stable across moves and renames. */
export function lyricsCacheName(q: LyricsQuery): string {
  const norm = (s: string): string => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const raw = `${norm(q.artist)}|${norm(q.title)}|${Math.round(q.durationSec)}`
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < raw.length; i++) { h1 = Math.imul(h1 ^ raw.charCodeAt(i), 16777619) >>> 0; h2 = (Math.imul(h2, 31) + raw.charCodeAt(i)) >>> 0 }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}.lrc`
}
