import { describe, expect, it } from 'vitest'
import { autoPreamp, defaultEq, EqSettingsSchema, eqResponseDb, PRESETS, sanitizeEq, setBand, withPreset } from './eq'

describe('eq', () => {
  it('flat gains give a 0 dB response everywhere', () => {
    for (const f of [20, 100, 1000, 10000]) expect(eqResponseDb(PRESETS['Flat']!, f)).toBeCloseTo(0, 6)
  })
  it('a single +6 dB peaking band peaks at its centre and falls off away from it', () => {
    const g = PRESETS['Flat']!.slice()
    g[5] = 6
    expect(eqResponseDb(g, 1000)).toBeCloseTo(6, 1)
    expect(eqResponseDb(g, 62)).toBeLessThan(0.5)
    expect(eqResponseDb(g, 16000)).toBeLessThan(0.5)
  })
  it('shelves lift the extremes', () => {
    expect(eqResponseDb(PRESETS['Bass boost']!, 31)).toBeGreaterThan(3)
    expect(eqResponseDb(PRESETS['Treble boost']!, 16000)).toBeGreaterThan(3)
  })
  it('preamp compensates the largest boost; presets enable the EQ', () => {
    expect(autoPreamp([0, 3, -4, 6])).toBe(-6)
    expect(autoPreamp([-3, -1])).toBe(-0)
    const p = withPreset('Vocal')!
    expect(p.enabled).toBe(true)
    expect(p.preamp).toBe(-4)
    expect(withPreset('Nope')).toBeNull()
  })
  it('setBand clamps, rounds to half dB and marks the preset Custom', () => {
    const e = setBand(defaultEq, 3, 99)
    expect(e.gains[3]).toBe(12)
    expect(setBand(defaultEq, 3, 2.3).gains[3]).toBe(2.5)
    expect(e.preset).toBe('Custom')
    expect(defaultEq.gains[3]).toBe(0) // input not mutated
  })
  it('rejects out-of-range or wrong-length settings and sanitizes disk data', () => {
    expect(EqSettingsSchema.safeParse({ ...defaultEq, gains: [0] }).success).toBe(false)
    expect(EqSettingsSchema.safeParse({ ...defaultEq, preamp: 40 }).success).toBe(false)
    expect(sanitizeEq({ nonsense: true })).toEqual(defaultEq)
    expect(sanitizeEq(null)).toEqual(defaultEq)
    expect(sanitizeEq(withPreset('Loudness'))).toEqual(withPreset('Loudness'))
  })
})
