import { describe, expect, it } from 'vitest'
import { LoudnessMeter } from './loudness'

const sine = (fs: number, seconds: number, hz: number, amp: number, ch = 2): Float32Array => {
  const n = Math.round(fs * seconds)
  const out = new Float32Array(n * ch)
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[i * ch + c] = amp * Math.sin((2 * Math.PI * hz * i) / fs)
  return out
}
const db = (x: number): number => 10 ** (x / 20)

describe('integrated loudness (BS.1770-4)', () => {
  it('reads a −23 dBFS 1 kHz stereo tone as −23 LUFS (EBU Tech 3341 case 1)', () => {
    const m = new LoudnessMeter(48000)
    m.push(sine(48000, 20, 1000, db(-23)))
    expect(m.result().lufs).toBeCloseTo(-23, 0)
    expect(Math.abs(m.result().lufs! + 23)).toBeLessThan(0.15)
  })
  it('works at 44.1 and 96 kHz and reports the sample peak', () => {
    for (const fs of [44100, 96000]) {
      const m = new LoudnessMeter(fs)
      m.push(sine(fs, 10, 1000, db(-20)))
      expect(Math.abs(m.result().lufs! + 20)).toBeLessThan(0.2)
      expect(m.result().peakDb!).toBeCloseTo(-20, 1)
    }
  })
  it('gives the same answer however the samples are chunked, even mid-frame', () => {
    const all = sine(44100, 6, 440, 0.3)
    const a = new LoudnessMeter(44100); a.push(all)
    const b = new LoudnessMeter(44100)
    for (let i = 0; i < all.length; i += 4097) b.push(all.subarray(i, Math.min(all.length, i + 4097)))
    expect(b.result().lufs).toBeCloseTo(a.result().lufs!, 6)
  })
  it('ignores digital silence with the gates, and returns null for pure silence', () => {
    const tone = sine(48000, 10, 1000, db(-23))
    const padded = new Float32Array(tone.length * 2) // 10 s tone then 10 s of silence
    padded.set(tone)
    const m = new LoudnessMeter(48000); m.push(padded)
    expect(Math.abs(m.result().lufs! + 23)).toBeLessThan(0.2)
    const s = new LoudnessMeter(48000); s.push(new Float32Array(48000 * 2 * 5))
    expect(s.result().lufs).toBeNull()
    expect(s.result().dr).toBeNull()
  })
  it('a louder track reads louder, by the gain applied', () => {
    const a = new LoudnessMeter(44100); a.push(sine(44100, 8, 1000, db(-30)))
    const b = new LoudnessMeter(44100); b.push(sine(44100, 8, 1000, db(-20)))
    expect(b.result().lufs! - a.result().lufs!).toBeCloseTo(10, 1)
  })
})

describe('dynamic range (DR)', () => {
  const noiseWithPeaks = (fs: number, seconds: number, rms: number, peak: number): Float32Array => {
    const n = Math.round(fs * seconds)
    const out = new Float32Array(n * 2)
    let s = 12345
    const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5 }
    for (let i = 0; i < n; i++) {
      const v = rnd() * rms * Math.sqrt(12)
      out[i * 2] = v; out[i * 2 + 1] = v
    }
    for (let t = 0.5; t < seconds; t += 1) { const i = Math.round(t * fs); out[i * 2] = peak; out[i * 2 + 1] = peak } // one spike a second
    return out
  }
  it('a full-scale sine has DR 0, whatever its level', () => {
    for (const amp of [1, 0.5, 0.1]) {
      const m = new LoudnessMeter(44100); m.push(sine(44100, 12, 997, amp))
      expect(m.result().dr!).toBeLessThan(0.3)
    }
  })
  it('peaks well above the average give a high DR; squashing them gives a low one', () => {
    const dynamic = new LoudnessMeter(44100); dynamic.push(noiseWithPeaks(44100, 15, 0.05, 0.9))
    const squashed = new LoudnessMeter(44100); squashed.push(noiseWithPeaks(44100, 15, 0.3, 0.9))
    expect(dynamic.result().dr!).toBeGreaterThan(14)
    expect(squashed.result().dr!).toBeLessThan(dynamic.result().dr!)
    expect(dynamic.result().dr!).toBeGreaterThan(squashed.result().dr! + 8)
  })
  it('still answers for a track shorter than one 3 s block', () => {
    const m = new LoudnessMeter(44100); m.push(noiseWithPeaks(44100, 2, 0.1, 0.8))
    expect(m.result().dr).not.toBeNull()
  })
})
