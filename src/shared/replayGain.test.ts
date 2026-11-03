import { describe, expect, it } from 'vitest'
import { replayGainFactor } from './replayGain'

describe('replayGainFactor', () => {
  it('is neutral when off or untagged', () => {
    expect(replayGainFactor('off', -8, 0.9)).toBe(1)
    expect(replayGainFactor('track', null, 0.9)).toBe(1)
  })
  it('attenuates loud masters', () => expect(replayGainFactor('track', -6, 1)).toBeCloseTo(0.501, 2))
  it('only boosts when the peak allows it', () => {
    expect(replayGainFactor('track', 6, 0.9)).toBeCloseTo(1 / 0.9, 3) // capped by headroom
    expect(replayGainFactor('track', 6, 0.25)).toBeCloseTo(1.995, 2)
    expect(replayGainFactor('track', 6, null)).toBe(1) // no peak: never boost
  })
})
