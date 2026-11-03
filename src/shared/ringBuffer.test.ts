import { describe, expect, it } from 'vitest'
import { PcmRing } from '../renderer/public/player-worklet.js'

describe('PcmRing', () => {
  it('round-trips interleaved stereo and wraps without losing samples', () => {
    const ring = new PcmRing(2, 8)
    const src = new Float32Array([1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6])
    expect(ring.writeInterleaved(src, 6)).toBe(6)
    const out = [new Float32Array(4), new Float32Array(4)]
    expect(ring.read(out, 4)).toBe(4)
    expect(Array.from(out[0]!)).toEqual([1, 2, 3, 4])
    // wrap: write 5 more frames into the 6 free slots
    const more = new Float32Array(10).map((_, i) => 10 + i)
    expect(ring.writeInterleaved(more, 5)).toBe(5)
    const out2 = [new Float32Array(7), new Float32Array(7)]
    expect(ring.read(out2, 7)).toBe(7)
    expect(Array.from(out2[0]!)).toEqual([5, 6, 10, 12, 14, 16, 18])
    expect(ring.buffered).toBe(0)
  })

  it('refuses writes beyond capacity and reports partial acceptance', () => {
    const ring = new PcmRing(1, 4)
    expect(ring.writeInterleaved(new Float32Array(10), 10)).toBe(4)
    expect(ring.free).toBe(0)
  })

  it('flush drops buffered audio (seek)', () => {
    const ring = new PcmRing(1, 4)
    ring.writeInterleaved(new Float32Array(3), 3)
    ring.flush()
    expect(ring.buffered).toBe(0)
  })
})
