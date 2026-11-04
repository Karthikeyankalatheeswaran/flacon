import { describe, expect, it } from 'vitest'
import { VIZ_BARS, barRanges, foldBars, smooth } from './spectrum'

describe('spectrum', () => {
  it('makes contiguous, ascending, non-empty ranges for common rates', () => {
    for (const sr of [44100, 48000, 96000, 192000]) {
      const r = barRanges(sr, 2048)
      expect(r).toHaveLength(VIZ_BARS)
      r.forEach(([lo, hi], i) => {
        expect(hi).toBeGreaterThan(lo)
        if (i) expect(lo).toBe(r[i - 1]![1])
      })
      expect(r[VIZ_BARS - 1]![1]).toBeLessThanOrEqual(1024)
    }
  })
  it('puts a tone in the bar that covers its frequency', () => {
    const sr = 48000
    const bytes = new Uint8Array(1024)
    bytes[Math.round(1000 / (sr / 2048))] = 200
    const bars = foldBars(bytes, barRanges(sr, 2048))
    const hot = [...bars].findIndex((v) => v === 200)
    expect(hot).toBeGreaterThan(5)
    expect(hot).toBeLessThan(40)
    expect(bars.filter((v) => v > 0)).toHaveLength(1)
  })
  it('rises instantly and falls gradually', () => {
    const up = smooth(new Float32Array(2), new Uint8Array([255, 0]))
    expect(up[0]).toBe(1)
    const down = smooth(up, new Uint8Array([0, 0]))
    expect(down[0]).toBeCloseTo(0.88, 5)
    expect(down[1]).toBe(0)
  })
})
