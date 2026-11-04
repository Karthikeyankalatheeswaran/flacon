import { describe, expect, it } from 'vitest'
import { SHORTCUTS, acceleratorFromEvent, conflictWith, effective, normalizeAccelerator, prettyAccelerator, sanitizeShortcuts } from './shortcuts'

describe('shortcuts', () => {
  it('every default is valid and unique', () => {
    const seen = new Set<string>()
    for (const s of SHORTCUTS) {
      const n = normalizeAccelerator(s.def)
      expect(n, s.id).not.toBeNull()
      expect(seen.has(n!), `${s.id} duplicates a default`).toBe(false)
      seen.add(n!)
    }
  })
  it('normalises order and aliases', () => {
    expect(normalizeAccelerator('Shift+CmdOrCtrl+o')).toBe('CmdOrCtrl+Shift+O')
    expect(normalizeAccelerator('cmd+alt+p')).toBe('CmdOrCtrl+Alt+P')
  })
  it('rejects bare letters, unknown modifiers and keys', () => {
    expect(normalizeAccelerator('P')).toBeNull()
    expect(normalizeAccelerator('Shift+P')).toBeNull()
    expect(normalizeAccelerator('Super+P')).toBeNull()
    expect(normalizeAccelerator('CmdOrCtrl+Backspace')).toBeNull()
    expect(normalizeAccelerator('F5')).toBe('F5')
  })
  it('sanitizes stored overrides: unknown ids, junk, and reserved keys are dropped', () => {
    expect(sanitizeShortcuts({ next: 'ctrl+alt+n', bogus: 'CmdOrCtrl+K', prev: 'P', queue: 'CmdOrCtrl+Q', eq: 5 })).toEqual({ next: 'Ctrl+Alt+N' })
    expect(sanitizeShortcuts(null)).toEqual({})
    expect(sanitizeShortcuts('x')).toEqual({})
  })
  it('detects conflicts with defaults and with other overrides', () => {
    expect(conflictWith('next', 'CmdOrCtrl+Left', {})).toBe('prev')
    expect(conflictWith('next', 'CmdOrCtrl+Alt+K', {})).toBeNull()
    expect(conflictWith('prev', 'CmdOrCtrl+Alt+K', { next: 'CmdOrCtrl+Alt+K' })).toBe('next')
    expect(effective({ next: 'CmdOrCtrl+Alt+K' }).next).toBe('CmdOrCtrl+Alt+K')
  })
  it('records key presses per platform', () => {
    const e = { code: 'KeyK', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }
    expect(acceleratorFromEvent(e, true)).toBe('CmdOrCtrl+Alt+K')
    expect(acceleratorFromEvent({ ...e, metaKey: false, ctrlKey: true }, false)).toBe('CmdOrCtrl+Alt+K')
    expect(acceleratorFromEvent({ ...e, code: 'MetaLeft' }, true)).toBeNull()
    expect(acceleratorFromEvent({ ...e, code: 'ArrowUp', altKey: false }, true)).toBe('CmdOrCtrl+Up')
  })
  it('shows platform-appropriate labels', () => {
    expect(prettyAccelerator('CmdOrCtrl+Alt+P', true)).toBe('⌘⌥P')
    expect(prettyAccelerator('CmdOrCtrl+Alt+P', false)).toBe('Ctrl+Alt+P')
    expect(prettyAccelerator('CmdOrCtrl+Left', true)).toBe('⌘←')
  })
})
