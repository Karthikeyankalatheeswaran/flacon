import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SETTINGS_VERSION, defaultSettings, displayKey, isVisibleOn, loadSettings } from '@shared/settings'
import { createSettingsStore } from './settingsStore'

const dir = mkdtempSync(join(tmpdir(), 'flacon-set-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const f = (n: string): string => join(dir, n)

describe('settings schema', () => {
  it('falls back per field, not wholesale', () => {
    const r = loadSettings({ version: 1, theme: 'purple', volume: 7, launchAtLogin: true, session: { paths: 'nope' } })
    expect(r.settings).toMatchObject({ theme: 'system', volume: 0.8, launchAtLogin: true, session: null })
  })
  it('migrates the pre-versioned shape and reports it', () => {
    const r = loadSettings({ theme: 'dark', junk: 1 })
    expect(r.settings.theme).toBe('dark')
    expect(r.settings.version).toBe(SETTINGS_VERSION)
    expect(r.migratedFrom).toBe(0)
  })
  it('keeps what it understands from a newer file and flags it', () => {
    const r = loadSettings({ version: 99, theme: 'light', futureThing: true })
    expect(r.settings.theme).toBe('light')
    expect(r.newer).toBe(true)
  })
  it('treats non-objects as defaults', () => {
    for (const x of [null, 5, 'x', [], undefined]) expect(loadSettings(x).settings).toEqual(defaultSettings)
  })
  it('sanitizes a damaged window record without losing the others', () => {
    const good = { x: 10, y: 20, width: 900, height: 700, maximized: false }
    const r = loadSettings({ version: 1, windows: { a: good, b: { x: 'no' } } })
    expect(r.settings.windows['a']).toEqual(good)
    expect(r.settings.windows['b']!.width).toBe(1280)
  })
})

describe('window placement', () => {
  const screens = [{ x: 0, y: 0, width: 1440, height: 900 }]
  it('accepts bounds on a connected display and rejects ones stranded off-screen', () => {
    expect(isVisibleOn({ x: 100, y: 100, width: 1000, height: 700, maximized: false }, screens)).toBe(true)
    expect(isVisibleOn({ x: 3000, y: 100, width: 1000, height: 700, maximized: false }, screens)).toBe(false) // unplugged monitor
    expect(isVisibleOn({ x: 100, y: -600, width: 1000, height: 700, maximized: false }, screens)).toBe(false) // title bar unreachable
    expect(isVisibleOn({ x: 3000, y: 100, width: 1000, height: 700, maximized: false }, [...screens, { x: 2560, y: 0, width: 1920, height: 1080 }])).toBe(true)
  })
  it('keys displays by id and size', () => {
    expect(displayKey({ id: 7, size: { width: 2560, height: 1440 } })).toBe('7:2560x1440')
  })
})

describe('settings store', () => {
  it('round-trips through an atomic write', () => {
    const s = createSettingsStore(f('a.json'))
    s.set({ theme: 'dark', volume: 0.3 })
    s.flush()
    expect(JSON.parse(readFileSync(f('a.json'), 'utf8'))).toMatchObject({ version: 1, theme: 'dark', volume: 0.3 })
    expect(existsSync(f('a.json.tmp'))).toBe(false)
    expect(createSettingsStore(f('a.json')).get()).toMatchObject({ theme: 'dark', volume: 0.3 })
  })
  it('backs up a corrupt file, starts from defaults and says where the copy went', () => {
    writeFileSync(f('b.json'), '{ this is not json')
    const s = createSettingsStore(f('b.json'), () => 123)
    expect(s.get()).toEqual(defaultSettings)
    expect(s.recoveredFrom).toBe(f('b.json') + '.corrupt-123')
    expect(readFileSync(s.recoveredFrom!, 'utf8')).toBe('{ this is not json')
    expect(existsSync(f('b.json'))).toBe(false)
  })
  it('migrates an old file and keeps a backup of the old shape', () => {
    writeFileSync(f('c.json'), JSON.stringify({ theme: 'light' }))
    const s = createSettingsStore(f('c.json'))
    expect(s.get().theme).toBe('light')
    expect(s.migratedFrom).toBe(0)
    expect(readdirSync(dir)).toContain('c.json.v0.bak')
  })
  it('does not write when nothing changed and survives an unwritable path', () => {
    const s = createSettingsStore(f('d.json'))
    s.flush()
    expect(existsSync(f('d.json'))).toBe(false)
    const bad = createSettingsStore('/proc/definitely/not/writable/x.json')
    bad.set({ volume: 0.1 })
    expect(() => bad.flush()).not.toThrow()
    expect(bad.get().volume).toBe(0.1)
  })
})
