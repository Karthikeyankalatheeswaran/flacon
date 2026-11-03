// Pure tag/library helpers (no I/O) so the worker's rules are unit-testable.
import type { Quality } from './library'

/** Strip NULs and control chars; collapse whitespace. Tags with embedded nulls are common in old rips. */
export function cleanString(s: string | undefined | null): string {
  if (!s) return ''
  // eslint-disable-next-line no-control-regex
  return fixMojibake(s.replace(/\u0000+/g, '').replace(/[\u0001-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim())
}

/**
 * Recover UTF-8 text that was decoded as Latin-1/CP1252 ("CafÃ©" → "Café"). Only applies when the
 * result is cleaner than the input: every char fits a byte, and the re-decoded text has no U+FFFD.
 */
export function fixMojibake(s: string): string {
  // Lead byte (Â…ô) followed by a continuation byte, which CP1252 shows as U+0080–00BF or punctuation.
  if (!/[Â-ô][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(s)) return s
  const cp1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f }
  const bytes: number[] = []
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    const b = cp <= 0xff ? cp : cp1252[cp]
    if (b === undefined) return s // contains genuine non-Latin text: leave alone
    bytes.push(b)
  }
  const fixed = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes))
  return fixed.includes('�') ? s : fixed
}

/** "ARTIST" can hold several values ("A; B", "A / B", "A feat. B" stays one). */
export function splitMulti(values: string[] | string | undefined): string[] {
  const arr = Array.isArray(values) ? values : values ? [values] : []
  const out: string[] = []
  for (const v of arr) for (const part of cleanString(v).split(/\s*;\s*|\s*\u0000\s*/)) if (part && !out.includes(part)) out.push(part)
  return out
}

export function parseNumberOf(n: { no: number | null; of: number | null } | undefined): { no: number; of: number } {
  return { no: n?.no ?? 0, of: n?.of ?? 0 }
}

export interface RawTags {
  title?: string
  artist?: string
  artists?: string[]
  albumartist?: string
  album?: string
  year?: number
  genre?: string[]
  compilation?: boolean
}

export interface Normalized {
  title: string
  artist: string
  albumArtist: string
  album: string
  year: number
  genre: string
  compilation: boolean
}

/** Missing tags fall back to folder/filename so every file lands somewhere sensible. */
export function normalizeTags(raw: RawTags, filePath: string): Normalized {
  const parts = filePath.split(/[\\/]/)
  const file = (parts.pop() ?? '').replace(/\.[^.]+$/, '')
  const folder = parts.pop() ?? ''
  const artists = splitMulti(raw.artists?.length ? raw.artists : raw.artist)
  const artist = artists.join(', ') || 'Unknown Artist'
  const compilation = !!raw.compilation
  const albumArtist = cleanString(raw.albumartist) || (compilation ? 'Various Artists' : artists[0] || 'Unknown Artist')
  return {
    title: cleanString(raw.title) || file.replace(/^\d+[\s._-]+/, '') || file,
    artist,
    albumArtist,
    album: cleanString(raw.album) || folder || 'Unknown Album',
    year: raw.year ?? 0,
    genre: splitMulti(raw.genre).join(', '),
    compilation
  }
}

/** Case/diacritic-insensitive key. Quality is deliberately NOT part of it: the same album in
 *  FLAC and MP3 groups together and the highest quality wins. */
export function albumKey(albumArtist: string, album: string): string {
  const f = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
  return `${f(albumArtist)}\u0001${f(album)}`
}

const RANK: Record<Quality, number> = { lossy: 0, cd: 1, upscaled: 1, hires: 2 }
export const betterQuality = (a: Quality, b: Quality): Quality => (RANK[a] >= RANK[b] ? a : b)

export function inferQuality(f: { lossless: boolean; bitDepth: number | null; sampleRate: number }): Quality {
  if (!f.lossless) return 'lossy'
  return (f.bitDepth ?? 16) > 16 || f.sampleRate > 48000 ? 'hires' : 'cd'
}

/** Deterministic placeholder tint from the album key (real colour sampling comes with art decoding). */
export function hueTint(key: string): string {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  const hue = (h >>> 0) % 360
  // HSL(hue, 13%, 16%) → hex; near-graphite with only a whisper of the album's hue, so the player stays calm and passes the 4.5:1 guard against chalk.
  const s = 0.13, l = 0.16
  const k = (n: number): number => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

/** FTS5 MATCH string from user input: tokens quoted (no syntax injection), last one prefix-matched. */
export function ftsQuery(input: string): string {
  const tokens = input.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8)
  return tokens.map((t, i) => `"${t}"${i === tokens.length - 1 ? '*' : ''}`).join(' ')
}
