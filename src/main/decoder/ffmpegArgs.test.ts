import { describe, expect, it } from 'vitest'
import { decodeArgs, parseInfo, titleFromPath } from './ffmpegArgs'

const FLAC = `Input #0, flac, from 'a.flac':
  Duration: 00:04:12.37, start: 0.000000, bitrate: 2800 kb/s
  Stream #0:0: Audio: flac, 96000 Hz, stereo, s32 (24 bit)`
const MP3 = `  Duration: 00:03:00.05, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s`
const SURROUND = `  Duration: 01:00:00.00, start: 0
  Stream #0:0: Audio: ac3, 48000 Hz, 5.1(side), fltp, 448 kb/s`

describe('parseInfo', () => {
  it('reads FLAC 24/96', () => {
    expect(parseInfo(FLAC, 'a.flac')).toMatchObject({ codec: 'flac', sampleRate: 96000, channels: 2, bitDepth: 24 })
    expect(parseInfo(FLAC, 'a.flac')?.durationSec).toBeCloseTo(252.37)
  })
  it('handles lossy and multichannel', () => {
    expect(parseInfo(MP3, 'a.mp3')).toMatchObject({ codec: 'mp3', sampleRate: 44100, bitDepth: null })
    expect(parseInfo(SURROUND, 'a.ac3')?.channels).toBe(6)
  })
  it('returns null for garbage (corrupt file)', () => {
    expect(parseInfo('Invalid data found when processing input', 'x')).toBeNull()
  })
})

describe('decodeArgs', () => {
  it('seeks before the input, downmixes to stereo and resamples', () => {
    const a = decodeArgs('/m/a.flac', 12.5, 48000)
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))
    expect(a).toEqual(expect.arrayContaining(['-ac', '2', '-ar', '48000', 'f32le']))
  })
  it('titles from filename without extension', () => {
    expect(titleFromPath('C:\\Music\\01 Intro.flac')).toBe('01 Intro')
  })
})
