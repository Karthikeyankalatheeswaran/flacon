import { describe, expect, it } from 'vitest'
import { meanPurity, purityBadge, purityDetail, purityPercent, purityTier } from './purity'

describe('purity', () => {
  it('scores signal against Nyquist', () => {
    expect(purityPercent(22050, 22050)).toBe(100)
    expect(purityPercent(21500, 22050)).toBe(100) // within 4 %
    expect(purityPercent(22050, 48000)).toBe(46)
    expect(purityPercent(0, 48000)).toBe(0)
  })
  it('tiers and badges', () => {
    expect(purityTier(100)).toBe('pure')
    expect(purityTier(80)).toBe('good')
    expect(purityTier(46)).toBe('thin')
    expect(purityBadge({ purity: 46, lossless: true })).toBe('Thin 46%')
    expect(purityBadge({ purity: null, lossless: true })).toBe('Measuring…')
    expect(purityBadge({ purity: 99, lossless: false })).toBe('Lossy')
  })
  it('explains itself', () => {
    expect(purityDetail({ purity: 46, ceilingKhz: 22, lossless: true, effBits: 16, bitDepth: 24, upscaled: true })).toMatch(/stops near 22 kHz.*only uses 16.*upscaled/)
  })
  it('averages only what is measured', () => {
    expect(meanPurity([100, null, 80])).toBe(90)
    expect(meanPurity([null])).toBeNull()
  })
})
