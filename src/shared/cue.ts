// CUE sheet support: parse a .cue into tracks with start offsets, and the virtual-path scheme that lets
// the rest of the app treat each cue track like a file ("/m/album#cue02.flac" ⇒ real file "/m/album.flac").

export interface CueTrack { number: number; title: string; performer: string; startSec: number; file: string }
export interface CueSheet { title: string; performer: string; date: number; genre: string; tracks: CueTrack[] }

const FRAMES_PER_SEC = 75

/** Decode bytes as UTF-8, falling back to Latin-1 (older rips) when the bytes are not valid UTF-8. */
export function decodeCue(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

const unquote = (s: string): string => {
  const t = s.trim()
  const m = /^"((?:[^"\\]|\\.)*)"/.exec(t)
  return (m ? m[1]! : t.split(/\s+/)[0] ?? '').trim()
}

const mmssff = (s: string): number | null => {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(s.trim())
  if (!m) return null
  const [mm, ss, ff] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (ss > 59 || ff >= FRAMES_PER_SEC) return null
  return mm * 60 + ss + ff / FRAMES_PER_SEC
}

/** Pure parser. Tolerant of bad lines (skipped); tracks without INDEX 01 are dropped; multiple FILEs are kept per-track. */
export function parseCue(text: string): CueSheet {
  const sheet: CueSheet = { title: '', performer: '', date: 0, genre: '', tracks: [] }
  let file = ''
  let cur: (CueTrack & { has: boolean }) | null = null
  const commit = (): void => {
    if (cur?.has) sheet.tracks.push({ number: cur.number, title: cur.title, performer: cur.performer, startSec: cur.startSec, file: cur.file })
    cur = null
  }
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    const sp = line.search(/\s/)
    const cmd = (sp === -1 ? line : line.slice(0, sp)).toUpperCase()
    const rest = sp === -1 ? '' : line.slice(sp + 1).trim()
    if (cmd === 'FILE') {
      commit()
      file = unquote(rest)
    } else if (cmd === 'TRACK') {
      commit()
      const m = /^(\d+)\s+AUDIO/i.exec(rest)
      cur = m ? { number: Number(m[1]), title: '', performer: '', startSec: 0, file, has: false } : null // DATA tracks etc. are skipped
    } else if (cmd === 'TITLE') {
      if (cur) cur.title = unquote(rest)
      else sheet.title = unquote(rest)
    } else if (cmd === 'PERFORMER') {
      if (cur) cur.performer = unquote(rest)
      else sheet.performer = unquote(rest)
    } else if (cmd === 'INDEX' && cur) {
      const m = /^(\d+)\s+(\S+)/.exec(rest)
      const t = m && Number(m[1]) === 1 ? mmssff(m[2]!) : null
      if (t !== null) {
        cur.startSec = t
        cur.has = true
      }
    } else if (cmd === 'REM') {
      const m = /^(DATE|GENRE)\s+(.+)$/i.exec(rest)
      if (m && !cur) {
        if (m[1]!.toUpperCase() === 'DATE') sheet.date = Number(/\d{4}/.exec(m[2]!)?.[0] ?? 0)
        else sheet.genre = unquote(m[2]!)
      }
    }
  }
  commit()
  return sheet
}

/** Track end times: the next track in the same file starts where this one ends; the last runs to the file's end. */
export function trackEnds(tracks: CueTrack[], durationOf: (file: string) => number): number[] {
  return tracks.map((t, i) => {
    const next = tracks[i + 1]
    const end = next && next.file === t.file ? next.startSec : durationOf(t.file)
    return Math.max(t.startSec, end)
  })
}

// ---- virtual paths ----
const CUE_PATH = /#cue(\d{1,3})(\.[A-Za-z0-9]+)$/

export const cueVirtualPath = (file: string, n: number): string => file.replace(/(\.[^.\\/]+)$/, `#cue${String(n).padStart(2, '0')}$1`)
export const isCuePath = (p: string): boolean => CUE_PATH.test(p)
/** The audio file a (possibly virtual) path plays from. */
export const cueRealPath = (p: string): string => p.replace(CUE_PATH, '$2')
