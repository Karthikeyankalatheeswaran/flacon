import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { parseFile } from 'music-metadata'
import { parseLyrics, type Lyrics } from '@shared/lyrics'
import { cueRealPath } from '@shared/cue'

/** Sidecar `.lrc` first (same base name), then lyrics cached from an online lookup, then the tags. */
export async function readLyrics(path: string, cacheFile: string | null = null): Promise<Lyrics | null> {
  const real = cueRealPath(path)
  const base = real.slice(0, real.length - extname(real).length)
  for (const ext of ['.lrc', '.LRC']) {
    try {
      const st = await fs.stat(base + ext)
      if (st.size > 512 * 1024) continue
      const l = parseLyrics((await fs.readFile(base + ext)).toString('utf8'), 'sidecar')
      if (l) return l
    } catch {
      /* no sidecar */
    }
  }
  if (cacheFile) {
    try {
      const l = parseLyrics((await fs.readFile(cacheFile)).toString('utf8'), 'online')
      if (l) return l
    } catch {
      /* nothing cached */
    }
  }
  try {
    const meta = await parseFile(real, { skipCovers: true, skipPostHeaders: true })
    for (const tag of meta.common.lyrics ?? []) {
      if (tag.syncText?.length) {
        const lines = tag.syncText.map((x) => ({ t: (x.timestamp ?? 0) / 1000, text: x.text.trim() }))
        if (lines.some((l) => l.text)) return { synced: true, lines, source: 'embedded' }
      }
      if (tag.text) {
        const l = parseLyrics(tag.text, 'embedded')
        if (l) return l
      }
    }
  } catch {
    /* unreadable: no lyrics */
  }
  return null
}
