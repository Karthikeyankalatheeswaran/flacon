import { describe, expect, it } from 'vitest'
import { contrast, guardTint } from './tint'
import { initialIsland, islandReducer, restFor } from './islandMachine'
import { timecode } from './library'

describe('tint guard', () => {
  it('keeps passing tints and darkens failing ones to ≥4.5:1 against chalk', () => {
    expect(guardTint('#13303A')).toBe('#13303a')
    const g = guardTint('#E8622C')
    expect(contrast(g, '#EDEDE8')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('island machine (M4)', () => {
  it('rests as a dot with no track and returns there after an activity', () => {
    let m = islandReducer(initialIsland, { type: 'rest', rest: restFor(false) })
    expect(m.state).toBe('dot')
    m = islandReducer(m, { type: 'activity' })
    expect(m.state).toBe('activity')
    expect(islandReducer(m, { type: 'dismiss' }).state).toBe('dot')
  })
  it('a new rest never interrupts an error or activity but applies afterwards', () => {
    let m = islandReducer(initialIsland, { type: 'error' })
    m = islandReducer(m, { type: 'rest', rest: 'dot' })
    expect(m.state).toBe('error')
    expect(islandReducer(m, { type: 'dismiss' }).state).toBe('dot')
  })
  it('expanded collapses on pointer-leave; hidden stays hidden', () => {
    let m = islandReducer(initialIsland, { type: 'click' })
    expect(m.state).toBe('expanded')
    expect(islandReducer(m, { type: 'pointer-leave' }).state).toBe('compact')
    m = islandReducer(initialIsland, { type: 'hide' })
    expect(islandReducer(m, { type: 'rest', rest: 'compact' }).state).toBe('hidden')
    expect(islandReducer(m, { type: 'error' }).state).toBe('hidden')
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
