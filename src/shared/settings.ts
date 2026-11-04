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
  /** Where the island sits: screen edge and alignment along it. */
  islandEdge: z.enum(['top', 'bottom']).catch('top'),
  islandAlign: z.enum(['left', 'center', 'right']).catch('center'),
  /** Name of the sound output chosen in Settings; '' follows the system default. */
  outputDevice: z.string().max(256).catch(''),
  volume: z.number().min(0).max(1).catch(0.8),
  /** Floating island: on/off, when it shows, size, artwork and the purity badge. */
  islandEnabled: z.boolean().catch(true),
  islandMode: z.enum(['always', 'playing']).catch('always'),
  islandSize: z.enum(['compact', 'comfortable']).catch('comfortable'),
  islandArt: z.boolean().catch(true),
  islandBadge: z.boolean().catch(true),
  /** Island look: rolling water (default), flat black ink, tinted by the record, paper-light, or a slow aurora of the record's colour. */
  islandStyle: z.enum(['water', 'ink', 'record', 'paper', 'aurora']).catch('water'),
  replayGain: z.enum(['off', 'track']).catch('off'),
  /** Seconds of overlap between tracks; 0 = gapless without a fade. */
  crossfade: z.number().int().min(0).max(10).catch(0),
  showLyrics: z.boolean().catch(false),
  /** Look up missing lyrics on LRCLIB (sends artist, title, album and length). Off until the user opts in. */
  lyricsOnline: z.boolean().catch(false),
  /** Where the mini player was last left (main-only; not part of the renderer-facing settings). */
  miniPos: z.object({ x: z.number().int(), y: z.number().int() }).nullable().catch(null),
  /** Custom keyboard shortcuts: command id → accelerator. Only differences from the defaults are stored. */
  shortcuts: z.record(z.string().max(40), z.string().max(40)).catch({}),
  shuffle: z.boolean().catch(false),
  repeat: z.enum(['off', 'all', 'one']).catch('off'),
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
