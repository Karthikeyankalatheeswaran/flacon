/** Duplicate detection: the same recording stored more than once. Pure, so it is tested without a database. */

export interface DupRow {
  path: string
  title: string
  artist: string
  album: string
  durationSec: number
  codec: string
  sampleRate: number
  bitDepth: number | null
  size: number
  lossless: boolean
  purity: number | null
  dr: number | null
}

export interface DuplicateGroup {
  title: string
  artist: string
  durationSec: number
  /** Best copy first: that one is the suggested keeper. */
  members: DupRow[]
}

/** Seconds two copies of one recording may differ by (encoder padding, trimmed silence). */
export const DUP_DURATION_TOLERANCE = 2

/** Case, accents, punctuation and spacing never make two songs different. */
export function normName(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Higher is better: lossless, then resolution, then measured purity, then file size. */
export function copyScore(r: DupRow): number {
  const res = (r.bitDepth ?? 16) * r.sampleRate
  return (r.lossless ? 1e12 : 0) + res * 1e3 + (r.purity ?? 0) * 100 + Math.min(r.size, 9e8) / 1e9
}

export function findDuplicates(rows: DupRow[]): DuplicateGroup[] {
  const byName = new Map<string, DupRow[]>()
  for (const r of rows) {
    const t = normName(r.title)
    if (!t) continue
    const k = `${normName(r.artist)}|${t}`
    const list = byName.get(k)
    if (list) list.push(r)
    else byName.set(k, [r])
  }
  const out: DuplicateGroup[] = []
  for (const list of byName.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.durationSec - b.durationSec)
    let cluster: DupRow[] = []
    const flush = (): void => {
      if (cluster.length > 1) {
        const members = [...cluster].sort((a, b) => copyScore(b) - copyScore(a) || a.path.localeCompare(b.path))
        const best = members[0]!
        out.push({ title: best.title, artist: best.artist, durationSec: best.durationSec, members })
      }
      cluster = []
    }
    for (const r of list) {
      const last = cluster[cluster.length - 1]
      if (last && r.durationSec - last.durationSec > DUP_DURATION_TOLERANCE) flush()
      cluster.push(r)
    }
    flush()
  }
  return out.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
}

/**
 * Which of `requested` may be moved to the Trash: only files that sit in a duplicate group, and never so many
 * that a group would be left with no copy at all.
 */
export function safeToTrash(groups: DuplicateGroup[], requested: string[]): string[] {
  const want = new Set(requested)
  const allowed: string[] = []
  for (const g of groups) {
    const chosen = g.members.filter((m) => want.has(m.path))
    if (chosen.length === 0) continue
    // Keep at least one: if every copy was ticked, spare the best one.
    const keep = chosen.length === g.members.length ? g.members[0]!.path : null
    for (const m of chosen) if (m.path !== keep) allowed.push(m.path)
  }
  return allowed
}
