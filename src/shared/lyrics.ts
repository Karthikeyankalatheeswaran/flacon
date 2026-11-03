// Lyrics: synced LRC ("[01:23.45] line") or plain text, from a sidecar .lrc or an embedded tag.

export interface LyricLine { t: number | null; text: string }
export interface Lyrics { synced: boolean; lines: LyricLine[]; source: 'sidecar' | 'embedded' }

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

export function parseLyrics(raw: string, source: Lyrics['source']): Lyrics | null {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines: LyricLine[] = []
  let timed = 0
  for (const row of text.split('\n')) {
    const stamps = [...row.matchAll(STAMP)]
    const body = row.replace(STAMP, '').trim()
    if (stamps.length === 0) {
      if (/^\[(ti|ar|al|by|offset|length|re|ve|au):/i.test(row.trim())) continue // LRC metadata headers
      lines.push({ t: null, text: body })
      continue
    }
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: body })
      timed++
    }
  }
  if (!lines.some((l) => l.text !== '')) return null
  const useful = lines
  const synced = timed >= 2
  const out = synced ? useful.filter((l) => l.t !== null).sort((a, b) => a.t! - b.t!) : trimBlank(useful.map((l) => ({ t: null, text: l.text })))
  return { synced, lines: out.slice(0, 2000), source }
}

/** Index of the line being sung at `sec` (-1 before the first line). Binary search. */
export function activeLine(lines: LyricLine[], sec: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((lines[mid]!.t ?? Infinity) <= sec + 0.15) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

function trimBlank(l: LyricLine[]): LyricLine[] {
  let a = 0, b = l.length
  while (a < b && l[a]!.text === '') a++
  while (b > a && l[b - 1]!.text === '') b--
  return l.slice(a, b)
}
