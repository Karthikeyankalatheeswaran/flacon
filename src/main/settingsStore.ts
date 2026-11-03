import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SETTINGS_VERSION, defaultSettings, loadSettings, type Settings } from '@shared/settings'

export interface SettingsStore {
  get(): Settings
  set(patch: Partial<Settings>): Settings
  /** Write now (quit). */
  flush(): void
  /** Set when the file was unreadable: where the damaged copy was kept. The UI tells the user. */
  readonly recoveredFrom: string | null
  readonly migratedFrom: number | null
}

/**
 * Small versioned JSON store (no native or ESM-only dependency). Corrupt file → moved aside and defaults used.
 * Writes are debounced and atomic (temp file + rename), so a crash can't leave a half-written file.
 */
export function createSettingsStore(file: string, now: () => number = Date.now): SettingsStore {
  let recoveredFrom: string | null = null
  let migratedFrom: number | null = null
  let current: Settings = defaultSettings

  if (existsSync(file)) {
    try {
      const r = loadSettings(JSON.parse(readFileSync(file, 'utf8')))
      current = r.settings
      migratedFrom = r.migratedFrom
      if (r.migratedFrom !== null || r.newer) copyFileSync(file, `${file}.v${r.migratedFrom ?? 'newer'}.bak`) // keep the old shape once
    } catch {
      recoveredFrom = `${file}.corrupt-${now()}`
      try {
        renameSync(file, recoveredFrom)
      } catch {
        recoveredFrom = null
      }
    }
  }

  let timer: NodeJS.Timeout | undefined
  let dirty = false
  const write = (): void => {
    clearTimeout(timer)
    if (!dirty) return
    dirty = false
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify({ ...current, version: SETTINGS_VERSION }, null, 2))
      renameSync(tmp, file)
    } catch {
      /* read-only profile: settings just won't persist */
    }
  }

  return {
    get: () => current,
    set(patch) {
      current = { ...current, ...patch }
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(write, 500)
      return current
    },
    flush: write,
    get recoveredFrom() { return recoveredFrom },
    get migratedFrom() { return migratedFrom }
  }
}
