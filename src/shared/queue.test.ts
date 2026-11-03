import { describe, expect, it } from 'vitest'
import { insertAt, moveItem, nextIndex, removeAt, shuffleAfter, shuffled } from './queue'

const q = (...n: number[]) => ({ queue: n, index: 0 })

describe('nextIndex', () => {
  it('advances, stops at the end, wraps on repeat-all, stays on repeat-one', () => {
    expect(nextIndex(0, 3, 'off')).toBe(1)
    expect(nextIndex(2, 3, 'off')).toBeNull()
    expect(nextIndex(2, 3, 'all')).toBe(0)
    expect(nextIndex(1, 3, 'one')).toBe(1)
    expect(nextIndex(0, 0, 'all')).toBeNull()
  })
})

describe('shuffle', () => {
  const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]! }
  it('keeps every item exactly once', () => {
    const out = shuffled([1, 2, 3, 4, 5, 6], seq([0.1, 0.9, 0.4, 0.7, 0.2]))
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('leaves played and current tracks where they are', () => {
    const out = shuffleAfter([1, 2, 3, 4, 5], 1, seq([0.3, 0.6]))
    expect(out.slice(0, 2)).toEqual([1, 2])
    expect([...out.slice(2)].sort()).toEqual([3, 4, 5])
  })
})

describe('queue edits', () => {
  it('inserts before the playing row and shifts the index', () => {
    expect(insertAt({ queue: [1, 2, 3], index: 1 }, 0, [9])).toEqual({ queue: [9, 1, 2, 3], index: 2 })
    expect(insertAt({ queue: [1, 2, 3], index: 1 }, 2, [9, 8])).toEqual({ queue: [1, 2, 9, 8, 3], index: 1 })
    expect(insertAt({ queue: [], index: 0 }, 0, [5])).toEqual({ queue: [5], index: 0 })
  })
  it('removes rows and keeps the playing row playing', () => {
    expect(removeAt({ queue: [1, 2, 3, 4], index: 2 }, 0)).toEqual({ queue: [2, 3, 4], index: 1 })
    expect(removeAt({ queue: [1, 2, 3, 4], index: 1 }, 3)).toEqual({ queue: [1, 2, 3], index: 1 })
    expect(removeAt({ queue: [1, 2, 3], index: 2 }, 2)).toEqual({ queue: [1, 2], index: 1 })
    expect(removeAt({ queue: [1], index: 0 }, 5)).toEqual({ queue: [1], index: 0 })
  })
  it('moves rows and tracks the playing one', () => {
    expect(moveItem({ queue: [1, 2, 3, 4], index: 1 }, 1, 3)).toEqual({ queue: [1, 3, 4, 2], index: 3 })
    expect(moveItem({ queue: [1, 2, 3, 4], index: 1 }, 3, 0)).toEqual({ queue: [4, 1, 2, 3], index: 2 })
    expect(moveItem({ queue: [1, 2, 3, 4], index: 1 }, 0, 2)).toEqual({ queue: [2, 3, 1, 4], index: 0 })
    expect(moveItem(q(1, 2), 0, 0)).toEqual(q(1, 2))
  })
})
