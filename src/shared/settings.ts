import { z } from 'zod'

// Versioned app settings. Each field falls back to its default on its own (`.catch`), so one bad value
// never resets the rest. Shape changes go through MIGRATIONS; the file's `version` says which have run.

export const SETTINGS_VERSION = 1

const Bounds = z.object({
  x: z.number().int().min(-100000).max(100000),
  y: z.number().int().min(-100000).max(100000),
  width: z.number().int().min(400).max(20000),
  height: z.number().int().min(300).max(20000),
  maximized: z.boolean()
})
export type WindowBounds = z.infer<typeof Bounds>

const Session = z.object({
  paths: z.array(z.string().max(4096)).max(5000),
  index: z.number().int().min(0),
  positionSec: z.number().min(0).max(36 * 3600)
})
export type Session = z.infer<typeof Session>

export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION).catch(SETTINGS_VERSION),
  theme: z.enum(['system', 'light', 'dark']).catch('system'),
  launchAtLogin: z.boolean().catch(false),
  pauseOnSuspend: z.boolean().catch(true),
  /** Look for new versions in the background (never downloads without a click). */
  updateChecks: z.boolean().catch(true),
  /** Windows only: which screen edge the island docks to. */
  islandEdge: z.enum(['top', 'bottom']).catch('top'),
  volume: z.number().min(0).max(1).catch(0.8),
  onboarded: z.boolean().catch(false),
  /** Main-window bounds remembered per display (key = display id + size), so a monitor swap doesn't strand the window. */
  windows: z.record(z.string().max(80), Bounds.catch({ x: 0, y: 0, width: 1280, height: 820, maximized: false })).catch({}),
  /** What was playing at quit: restored paused, so launching never blasts audio. */
  session: Session.nullable().catch(null)
})
export type Settings = z.infer<typeof SettingsSchema>

export const defaultSettings: Settings = SettingsSchema.parse({})

type Raw = Record<string, unknown>
/** MIGRATIONS[n] upgrades a version-n object to version n+1. */
const MIGRATIONS: Array<(r: Raw) => Raw> = [
  // v0 → v1: early builds stored only { theme } (no version field).
  (r) => ({ theme: r['theme'], version: 1 })
]

export type Loaded = { settings: Settings; migratedFrom: number | null; newer: boolean }

/** Parse whatever was on disk into valid settings, running migrations as needed. Never throws. */
export function loadSettings(raw: unknown): Loaded {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings: defaultSettings, migratedFrom: null, newer: false }
  let obj = raw as Raw
  const v = typeof obj['version'] === 'number' && Number.isInteger(obj['version']) && obj['version'] >= 0 ? (obj['version'] as number) : 0
  if (v > SETTINGS_VERSION) {
    // Written by a newer build: keep every field we understand, change nothing else.
    return { settings: SettingsSchema.parse({ ...obj, version: SETTINGS_VERSION }), migratedFrom: null, newer: true }
  }
  for (let i = v; i < SETTINGS_VERSION; i++) obj = MIGRATIONS[i]!(obj)
  return { settings: SettingsSchema.parse(obj), migratedFrom: v < SETTINGS_VERSION ? v : null, newer: false }
}

/** Stable key for a display configuration. */
export const displayKey = (d: { id: number; size: { width: number; height: number } }): string => `${d.id}:${d.size.width}x${d.size.height}`

/** Is at least a usable part of the window on one of the displays? (Guards restoring onto a monitor that is gone.) */
export function isVisibleOn(b: WindowBounds, areas: Array<{ x: number; y: number; width: number; height: number }>): boolean {
  return areas.some((a) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
    return w >= 200 && h >= 100 && b.y >= a.y - 20 // title bar must remain reachable
  })
}
