import { describe, expect, it } from 'vitest'
import { bandSpectrum, effectiveBitDepth, findCutoff, isFakeBitDepth, judgeSpectrum } from './analysis'
import { parseStreamInfo } from './streaminfo'

// Equal-amplitude comb of sines up to `top` Hz: flat spectrum that ends exactly where we choose.
function comb(top: number, sr = 44100, n = 4096 * 30): Float32Array {
  const out = new Float32Array(n)
  const freqs: number[] = []
  for (let f = 200; f < top; f += 97) freqs.push(f)
  const amp = 0.5 / freqs.length
  freqs.forEach((f, k) => {
    const ph = k * 2.399
    for (let i = 0; i < n; i++) out[i]! += amp * Math.sin((2 * Math.PI * f * i) / sr + ph)
  })
  return out
}

describe('spectral analysis', () => {
  it('finds a 16 kHz lowpass and flags a lossless file with it as a likely lossy source', () => {
    const c = findCutoff(bandSpectrum(comb(16000), 44100))
    expect(c.fullBand).toBe(false)
    expect(c.cutoffHz).toBeGreaterThan(15500)
    expect(c.cutoffHz).toBeLessThan(16700)
    expect(judgeSpectrum(c, 44100)).toMatchObject({ kind: 'likely-lossy-source', resembles: 16 })
  })
  it('flags a 19 kHz lowpass too', () => {
    expect(judgeSpectrum(findCutoff(bandSpectrum(comb(19000), 44100)), 44100)).toMatchObject({ kind: 'likely-lossy-source', resembles: 19 })
  })
  it('treats full-band material as fine', () => {
    const c = findCutoff(bandSpectrum(comb(21900), 44100))
    expect(c.fullBand).toBe(true)
    expect(judgeSpectrum(c, 44100)).toEqual({ kind: 'ok' })
  })
  it('does not judge low sample rates', () => {
    expect(judgeSpectrum({ cutoffHz: 16000, fullBand: false }, 32000)).toEqual({ kind: 'ok' })
  })
})

describe('bit depth', () => {
  const pcm = (f: (i: number) => number): Int32Array => Int32Array.from({ length: 5000 }, (_, i) => f(i))
  it('detects 16-bit audio padded into a 24-bit container', () => {
    const fake = pcm((i) => (Math.round(Math.sin(i / 7) * 20000) | 0) << 16)
    expect(effectiveBitDepth(fake)).toBe(16)
    expect(isFakeBitDepth(24, effectiveBitDepth(fake))).toBe(true)
  })
  it('accepts genuine 24-bit and ignores silence / too little signal', () => {
    const real = pcm((i) => (Math.round(Math.sin(i / 7) * 5_000_000) | 0) << 8)
    expect(effectiveBitDepth(real)).toBe(24)
    expect(isFakeBitDepth(24, 24)).toBe(false)
    expect(effectiveBitDepth(new Int32Array(10000))).toBeNull()
    expect(isFakeBitDepth(16, 16)).toBe(false)
  })
})

describe('STREAMINFO', () => {
  function header(sr: number, ch: number, bps: number, total: number, md5: number[]): Uint8Array {
    const h = new Uint8Array(42)
    h.set([0x66, 0x4c, 0x61, 0x43, 0x00, 0, 0, 34])
    const b = h.subarray(8)
    b[10] = sr >> 12; b[11] = (sr >> 4) & 255; b[12] = ((sr & 15) << 4) | ((ch - 1) << 1) | ((bps - 1) >> 4)
    b[13] = (((bps - 1) & 15) << 4) | (Math.floor(total / 2 ** 32) & 15)
    b[14] = (total >>> 24) & 255; b[15] = (total >>> 16) & 255; b[16] = (total >>> 8) & 255; b[17] = total & 255
    b.set(md5, 18)
    return h
  }
  it('reads rate, channels, bit depth, length and MD5', () => {
    const md5 = Array.from({ length: 16 }, (_, i) => i + 1)
    expect(parseStreamInfo(header(96000, 2, 24, 123456789, md5))).toEqual({
      sampleRate: 96000, channels: 2, bitsPerSample: 24, totalSamples: 123456789, md5: '0102030405060708090a0b0c0d0e0f10'
    })
  })
  it('reports a missing checksum and rejects non-FLAC data', () => {
    expect(parseStreamInfo(header(44100, 2, 16, 1000, new Array(16).fill(0)))!.md5).toBeNull()
    expect(parseStreamInfo(new Uint8Array(64))).toBeNull()
    expect(parseStreamInfo(new Uint8Array(10))).toBeNull()
  })
})
