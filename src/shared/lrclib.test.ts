import { describe, expect, it } from 'vitest'
import { lrclibUrl, lyricsCacheName, pickLrclib } from './lrclib'

const q = { artist: 'Halden', title: 'Undertow', album: 'Tidal', durationSec: 380.4 }
describe('lrclib', () => {
  it('builds an https URL on lrclib.net with only the track facts', () => {
    const u = new URL(lrclibUrl(q)!)
    expect(u.origin).toBe('https://lrclib.net')
    expect([...u.searchParams.keys()].sort()).toEqual(['album_name', 'artist_name', 'duration', 'track_name'])
    expect(u.searchParams.get('duration')).toBe('380')
  })
  it('encodes hostile titles instead of changing the request', () => {
    const u = new URL(lrclibUrl({ ...q, title: 'x&artist_name=evil#../../' })!)
    expect(u.host).toBe('lrclib.net')
    expect(u.searchParams.get('artist_name')).toBe('Halden')
  })
  it('refuses to search without artist, title and length', () => {
    expect(lrclibUrl({ ...q, artist: '' })).toBeNull()
    expect(lrclibUrl({ ...q, durationSec: 0 })).toBeNull()
  })
  it('prefers synced lyrics', () => {
    const r = pickLrclib({ plainLyrics: 'a\nb', syncedLyrics: '[00:01.00] a\n[00:02.00] b' })
    expect(r.kind === 'lyrics' && r.lyrics.synced).toBe(true)
  })
  it('falls back to plain lyrics, reports instrumentals, tolerates junk', () => {
    expect(pickLrclib({ plainLyrics: 'la la' }).kind).toBe('lyrics')
    expect(pickLrclib({ instrumental: true }).kind).toBe('instrumental')
    expect(pickLrclib('<html>').kind).toBe('none')
    expect(pickLrclib({ plainLyrics: 5 }).kind).toBe('none')
    expect(pickLrclib({ plainLyrics: 'x'.repeat(300_000) }).kind).toBe('none')
  })
  it('cache names are safe file names that ignore case and punctuation', () => {
    expect(lyricsCacheName(q)).toMatch(/^[0-9a-f]{16}\.lrc$/)
    expect(lyricsCacheName(q)).toBe(lyricsCacheName({ ...q, title: 'UNDERTOW!', durationSec: 380.2 }))
  })
})
