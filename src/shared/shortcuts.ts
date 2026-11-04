/** Keyboard shortcuts: the list of commands, their defaults, and the rules for custom ones. Pure and tested. */

export interface ShortcutDef { id: string; label: string; group: 'Playback' | 'View' | 'Go'; def: string }

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'playPause', label: 'Play / Pause', group: 'Playback', def: 'CmdOrCtrl+Alt+P' },
  { id: 'next', label: 'Next song', group: 'Playback', def: 'CmdOrCtrl+Right' },
  { id: 'prev', label: 'Previous song', group: 'Playback', def: 'CmdOrCtrl+Left' },
  { id: 'shuffle', label: 'Shuffle', group: 'Playback', def: 'CmdOrCtrl+Alt+S' },
  { id: 'volUp', label: 'Volume up', group: 'Playback', def: 'CmdOrCtrl+Up' },
  { id: 'volDown', label: 'Volume down', group: 'Playback', def: 'CmdOrCtrl+Down' },
  { id: 'queue', label: 'Show queue', group: 'View', def: 'CmdOrCtrl+Alt+U' },
  { id: 'lyrics', label: 'Show lyrics', group: 'View', def: 'CmdOrCtrl+Alt+L' },
  { id: 'eq', label: 'Equalizer', group: 'View', def: 'CmdOrCtrl+Alt+E' },
  { id: 'visualizer', label: 'Visualizer', group: 'View', def: 'CmdOrCtrl+Alt+V' },
  { id: 'island', label: 'Flacon island', group: 'View', def: 'CmdOrCtrl+Alt+I' },
  { id: 'mini', label: 'Mini player', group: 'View', def: 'CmdOrCtrl+Alt+M' },
  { id: 'goHome', label: 'Tonight', group: 'Go', def: 'CmdOrCtrl+1' },
  { id: 'goLibrary', label: 'Library', group: 'Go', def: 'CmdOrCtrl+2' },
  { id: 'goPlaylists', label: 'Playlists', group: 'Go', def: 'CmdOrCtrl+3' },
  { id: 'goFetch', label: 'Fetch', group: 'Go', def: 'CmdOrCtrl+4' },
  { id: 'goStats', label: 'Listening', group: 'Go', def: 'CmdOrCtrl+5' },
  { id: 'goDuplicates', label: 'Duplicates', group: 'Go', def: 'CmdOrCtrl+6' },
  { id: 'search', label: 'Search library', group: 'Go', def: 'CmdOrCtrl+F' }
]
const IDS = new Set(SHORTCUTS.map((s) => s.id))

/** Taken by standard menus (Edit, Window, app): customising to these would shadow copy/paste/quit. */
const RESERVED = new Set(['CmdOrCtrl+Q', 'CmdOrCtrl+W', 'CmdOrCtrl+C', 'CmdOrCtrl+V', 'CmdOrCtrl+X', 'CmdOrCtrl+A', 'CmdOrCtrl+Z', 'CmdOrCtrl+Shift+Z', 'CmdOrCtrl+M', 'CmdOrCtrl+H', 'CmdOrCtrl+,', 'CmdOrCtrl+N', 'CmdOrCtrl+O', 'CmdOrCtrl+CmdOrCtrl'])

const MODS = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift'] as const
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Left|Right|Up|Down|Space|,|\.|\/|-|=|\[|\]|;|')$/

/** Canonical form: modifiers in a fixed order, then the key. Null if it is not a usable accelerator. */
export function normalizeAccelerator(raw: string): string | null {
  const parts = raw.split('+').map((p) => p.trim())
  const rawKey = parts.pop()
  if (!rawKey) return null
  const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey.charAt(0).toUpperCase() + rawKey.slice(1).toLowerCase()
  if (!KEY.test(key)) return null
  const mods = new Set<string>()
  for (const p of parts) {
    const m = MODS.find((x) => x.toLowerCase() === p.toLowerCase()) ?? (p.toLowerCase() === 'cmd' || p.toLowerCase() === 'command' || p.toLowerCase() === 'control' ? 'CmdOrCtrl' : null)
    if (!m) return null
    mods.add(m)
  }
  const fKey = /^F\d+$/.test(key)
  if (!fKey && !mods.has('CmdOrCtrl') && !mods.has('Ctrl') && !mods.has('Alt')) return null // a bare letter would steal typing
  return [...MODS.filter((m) => mods.has(m)), key].join('+')
}

export const isReserved = (acc: string): boolean => RESERVED.has(acc)

/** Keep only known commands with usable, non-reserved accelerators that differ from nothing else: the stored overrides. */
export function sanitizeShortcuts(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!IDS.has(id) || typeof v !== 'string') continue
    const n = normalizeAccelerator(v)
    if (n && !isReserved(n)) out[id] = n
  }
  return out
}

export function effective(overrides: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of SHORTCUTS) out[s.id] = overrides[s.id] ?? normalizeAccelerator(s.def) ?? s.def
  return out
}

/** Which other command already uses `acc`, if any. */
export function conflictWith(id: string, acc: string, overrides: Record<string, string>): string | null {
  const eff = effective(overrides)
  for (const s of SHORTCUTS) if (s.id !== id && eff[s.id] === acc) return s.id
  return null
}

const CODE_KEYS: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Space: 'Space', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'" }
export interface KeyLike { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

/** A key press recorded in the Settings page → an accelerator string (null while only modifiers are held). */
export function acceleratorFromEvent(e: KeyLike, mac: boolean): string | null {
  let key = CODE_KEYS[e.code]
  if (!key) {
    const m = /^(?:Key([A-Z])|Digit(\d)|(F(?:[1-9]|1[0-2])))$/.exec(e.code)
    key = m ? (m[1] ?? m[2] ?? m[3]) : undefined
  }
  if (!key) return null
  const mods: string[] = []
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CmdOrCtrl')
  if (mac && e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return normalizeAccelerator([...mods, key].join('+'))
}

/** "CmdOrCtrl+Alt+P" → "⌘⌥P" on a Mac, "Ctrl+Alt+P" elsewhere. */
export function prettyAccelerator(acc: string, mac: boolean): string {
  const parts = acc.split('+')
  const key = parts.pop()!
  const arrows: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓' }
  const k = arrows[key] ?? key
  if (!mac) return [...parts.map((p) => (p === 'CmdOrCtrl' ? 'Ctrl' : p)), k].join('+')
  const sym: Record<string, string> = { CmdOrCtrl: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
  return parts.map((p) => sym[p] ?? p).join('') + k
}
