import { describe, expect, it } from 'vitest'
import { placeholderSleeve } from './library'

describe('placeholderSleeve', () => {
  it('is a data-URI SVG on top of the tint, deterministic per colour', () => {
    const a = placeholderSleeve('#13303A')
    expect(a).toBe(placeholderSleeve('#13303A'))
    expect(a).toMatch(/^url\("data:image\/svg\+xml,.+"\) center\/cover no-repeat, #13303A$/)
    expect(a).not.toBe(placeholderSleeve('#5A1F37'))
  })
  it('never lets an odd tint into the markup', () => {
    const a = placeholderSleeve('"></svg><script>')
    expect(a).not.toContain('script')
    expect(a.endsWith('#3a3d3a')).toBe(true) // falls back to neutral graphite
  })
  it('escapes # and double quotes so it is valid inside url("…")', () => {
    const inner = /^url\("(.*)"\) center/.exec(placeholderSleeve('#13303A'))![1]!
    expect(inner).not.toMatch(/#|"/)
  })
})
