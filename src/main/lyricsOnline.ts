import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { checkFetchUrl } from '@shared/fetch'
import { lrclibUrl, lyricsCacheName, pickLrclib, type LyricsQuery } from '@shared/lrclib'
import { electronFetch } from './fetcher/netFetch'
import { call as libraryCall, lyricsDir } from './library/client'
import type { LibrarySong } from '@shared/library'

export type LyricsOnlineResult = { status: 'found' | 'none' | 'instrumental' | 'error' | 'disabled' | 'unavailable' }

const MAX_BODY = 512 * 1024
const recentMiss = new Map<string, number>() // don't ask again about the same song for an hour
const inFlight = new Map<string, Promise<LyricsOnlineResult>>()

async function readCapped(res: Response, max: number): Promise<string | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    if (n > max) { void reader.cancel(); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** One lookup on LRCLIB for a library song; the result is cached on disk so it works offline afterwards. */
export function fetchLyricsOnline(path: string, enabled: boolean): Promise<LyricsOnlineResult> {
  if (!enabled) return Promise.resolve({ status: 'disabled' })
  const running = inFlight.get(path)
  if (running) return running
  const p = run(path).finally(() => inFlight.delete(path))
  inFlight.set(path, p)
  return p
}

async function run(path: string): Promise<LyricsOnlineResult> {
  const [song] = await libraryCall<LibrarySong[]>({ op: 'trackMetas', paths: [path] }) // only library songs: never an arbitrary renderer-chosen file
  if (!song) return { status: 'unavailable' }
  const q: LyricsQuery = { artist: song.artist, title: song.title, album: song.album, durationSec: song.durationSec }
  const url = lrclibUrl(q)
  if (!url || !checkFetchUrl(url).ok) return { status: 'unavailable' }
  const name = lyricsCacheName(q)
  const missAt = recentMiss.get(name)
  if (missAt && Date.now() - missAt < 3_600_000) return { status: 'none' }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10_000)
  try {
    // Generic client name only: no e-mail, no machine details.
    const res = await electronFetch(url, { headers: { 'user-agent': `Flacon/${app.getVersion()}`, accept: 'application/json' }, signal: ctl.signal, redirect: 'manual' })
    if (res.status === 404) { recentMiss.set(name, Date.now()); return { status: 'none' } }
    if (res.status !== 200) return { status: 'error' }
    const body = await readCapped(res, MAX_BODY)
    if (body === null) return { status: 'error' }
    let json: unknown
    try { json = JSON.parse(body) } catch { return { status: 'error' } }
    const r = pickLrclib(json)
    if (r.kind === 'instrumental') return { status: 'instrumental' }
    if (r.kind === 'none') { recentMiss.set(name, Date.now()); return { status: 'none' } }
    const dir = lyricsDir()
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, name), r.lrc, 'utf8')
    return { status: 'found' }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
