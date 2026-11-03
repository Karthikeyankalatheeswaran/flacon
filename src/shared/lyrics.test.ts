import { describe, expect, it } from 'vitest'
import { activeLine, parseLyrics } from './lyrics'

describe('parseLyrics', () => {
  it('parses synced lines, multiple stamps and ignores header tags', () => {
    const l = parseLyrics('[ti:Song]\n[ar:Me]\n[00:01.50]one\n[00:10.00][00:20.00]chorus\n[00:05]two', 'sidecar')!
    expect(l.synced).toBe(true)
    expect(l.lines.map((x) => x.text)).toEqual(['one', 'two', 'chorus', 'chorus'])
    expect(l.lines[0]!.t).toBe(1.5)
  })
  it('falls back to plain text', () => {
    const l = parseLyrics('first\nsecond\n\nthird', 'embedded')!
    expect(l.synced).toBe(false)
    expect(l.lines.map((x) => x.text)).toEqual(['first', 'second', '', 'third'])
  })
  it('returns null for empty input', () => expect(parseLyrics('\n  \n', 'embedded')).toBeNull())
})

describe('activeLine', () => {
  const lines = [{ t: 1, text: 'a' }, { t: 5, text: 'b' }, { t: 9, text: 'c' }]
  it('finds the line being sung', () => {
    expect(activeLine(lines, 0)).toBe(-1)
    expect(activeLine(lines, 1)).toBe(0)
    expect(activeLine(lines, 6)).toBe(1)
    expect(activeLine(lines, 100)).toBe(2)
  })
})
