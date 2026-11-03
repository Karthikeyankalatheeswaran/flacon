import { describe, expect, it } from 'vitest'
import { contrast, guardTint } from './tint'
import { initialIsland, islandReducer } from './islandMachine'
import { timecode } from './library'

describe('tint guard', () => {
  it('keeps passing tints and darkens failing ones to ≥4.5:1 against chalk', () => {
    expect(guardTint('#13303A')).toBe('#13303a')
    const g = guardTint('#E8622C')
    expect(contrast(g, '#EDEDE8')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('island machine', () => {
  it('hover → click expands, escape collapses, activity never interrupts expanded', () => {
    let m = islandReducer(initialIsland, { type: 'pointer-enter' })
    expect(m.state).toBe('hover')
    m = islandReducer(m, { type: 'click' })
    expect(m.state).toBe('expanded')
    expect(islandReducer(m, { type: 'activity' }).state).toBe('expanded')
    expect(islandReducer(m, { type: 'escape' }).state).toBe('compact')
  })
})

describe('timecode', () => {
  it('uses m:ss under an hour and h:mm:ss above', () => {
    expect(timecode(4)).toBe('0:04')
    expect(timecode(252)).toBe('4:12')
    expect(timecode(11528)).toBe('3:12:08')
  })
})
