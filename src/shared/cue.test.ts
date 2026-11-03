import { describe, expect, it } from 'vitest'
import { cueRealPath, cueVirtualPath, decodeCue, isCuePath, parseCue, trackEnds } from './cue'

const SHEET = `\uFEFFREM GENRE "Ambient"
REM DATE 2019
PERFORMER "Zed"
TITLE "Night Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Moth"
    PERFORMER "Zed"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Lantern, Pt. 1"
    INDEX 00 03:10:00
    INDEX 01 03:12:37
  TRACK 03 DATA
    INDEX 01 07:00:00
  TRACK 04 AUDIO
    TITLE "Bad index"
    INDEX 01 xx:yy
`

describe('parseCue', () => {
  const s = parseCue(decodeCue(new TextEncoder().encode(SHEET)))
  it('reads sheet fields and tracks, using INDEX 01 and skipping DATA / unparseable tracks', () => {
    expect(s).toMatchObject({ title: 'Night Album', performer: 'Zed', date: 2019, genre: 'Ambient' })
    expect(s.tracks.map((t) => [t.number, t.title])).toEqual([[1, 'Moth'], [2, 'Lantern, Pt. 1']])
    expect(s.tracks[1]!.startSec).toBeCloseTo(3 * 60 + 12 + 37 / 75, 5)
    expect(s.tracks[1]!.file).toBe('album.flac')
  })
  it('handles CRLF, unquoted values, and empty input', () => {
    const t = parseCue('FILE a.wav WAVE\r\nTRACK 1 AUDIO\r\nTITLE Foo\r\nINDEX 01 00:00:00\r\n')
    expect(t.tracks[0]).toMatchObject({ title: 'Foo', file: 'a.wav' })
    expect(parseCue('').tracks).toEqual([])
  })
  it('rejects out-of-range frames/seconds', () => {
    expect(parseCue('FILE "a.wav" WAVE\nTRACK 1 AUDIO\nINDEX 01 00:61:00').tracks).toEqual([])
    expect(parseCue('FILE "a.wav" WAVE\nTRACK 1 AUDIO\nINDEX 01 00:00:75').tracks).toEqual([])
  })
  it('decodes Latin-1 when not valid UTF-8', () => {
    expect(decodeCue(new Uint8Array([0x54, 0x49, 0x54, 0x4c, 0x45, 0x20, 0xe9]))).toContain('é')
  })
})

describe('trackEnds / virtual paths', () => {
  it('ends at the next start in the same file, else the file duration', () => {
    const tr = [{ number: 1, title: '', performer: '', startSec: 0, file: 'a' }, { number: 2, title: '', performer: '', startSec: 60, file: 'a' }, { number: 3, title: '', performer: '', startSec: 0, file: 'b' }]
    expect(trackEnds(tr, (f) => (f === 'a' ? 200 : 90))).toEqual([60, 200, 90])
  })
  it('round-trips virtual paths and keeps an audio extension', () => {
    const v = cueVirtualPath('/m/Night Album/album.flac', 2)
    expect(v).toBe('/m/Night Album/album#cue02.flac')
    expect(isCuePath(v)).toBe(true)
    expect(cueRealPath(v)).toBe('/m/Night Album/album.flac')
    expect(isCuePath('/m/a.flac')).toBe(false)
    expect(cueRealPath('C:\\M\\a#cue10.wav')).toBe('C:\\M\\a.wav')
  })
})
