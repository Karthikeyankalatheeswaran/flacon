import { describe, expect, it } from 'vitest'
import { applyClick, emptySelection, moveFocus } from './selection'

const sorted = (s: { indices: ReadonlySet<number> }): number[] => [...s.indices].sort((a, b) => a - b)

describe('applyClick', () => {
  it('plain click selects exactly one', () => {
    const s = applyClick(applyClick(emptySelection, 2, { shift: false, toggle: false }), 5, { shift: false, toggle: false })
    expect(sorted(s)).toEqual([5])
  })
  it('ctrl toggles', () => {
    let s = applyClick(emptySelection, 1, { shift: false, toggle: true })
    s = applyClick(s, 4, { shift: false, toggle: true })
    expect(sorted(s)).toEqual([1, 4])
    expect(sorted(applyClick(s, 1, { shift: false, toggle: true }))).toEqual([4])
  })
  it('shift selects the range from the anchor, in either direction', () => {
    const a = applyClick(emptySelection, 3, { shift: false, toggle: false })
    expect(sorted(applyClick(a, 6, { shift: true, toggle: false }))).toEqual([3, 4, 5, 6])
    expect(sorted(applyClick(a, 1, { shift: true, toggle: false }))).toEqual([1, 2, 3])
  })
  it('shift with no anchor behaves like a click', () => {
    expect(sorted(applyClick(emptySelection, 7, { shift: true, toggle: false }))).toEqual([7])
  })
})

describe('moveFocus', () => {
  it('clamps at both ends and extends with shift', () => {
    const a = applyClick(emptySelection, 0, { shift: false, toggle: false })
    expect(moveFocus(a, 0, -1, 10, false).focus).toBe(0)
    const r = moveFocus(a, 0, 2, 10, true)
    expect(r.focus).toBe(2)
    expect(sorted(r.selection)).toEqual([0, 1, 2])
    expect(moveFocus(a, 9, 1, 10, false).focus).toBe(9)
  })
})
