// Library worker (utilityProcess): scanning, tag parsing, artwork, SQLite, watching.
// Main holds no heavy work; it just proxies requests and forwards progress.
import { mkdirSync, promises as fs } from 'node:fs'
import chokidar, { type FSWatcher } from 'chokidar'
import { isAudioPath } from '@shared/playback'
import { artUrl, type Album, type LibraryRequest, type LibraryTrack } from '@shared/library'
import { ftsQuery } from '@shared/tags'
import { openDb, type Db } from './db'
import { createIndexer, type Indexer } from './indexer'

let db: Db
let indexer: Indexer
let watcher: FSWatcher | null = null
let scanning: Promise<void> | null = null

const post = (m: unknown): void => process.parentPort.postMessage(m)

function albumRows(where = '', ...params: unknown[]): Album[] {
  const rows = db.prepare(`select id, title, album_artist as artist, art, tint, quality, ceiling, minutes, offline, track_count as trackCount from albums ${where} order by added_at desc, id desc`).all(...params) as Array<{
    id: number; title: string; artist: string; art: string | null; tint: string; quality: Album['quality']; ceiling: number; minutes: number; offline: number; trackCount: number
  }>
  return rows.map((r) => ({
    id: String(r.id), title: r.title, artist: r.artist, quality: r.quality, ceilingKhz: Math.round(r.ceiling * 100) / 100, minutes: r.minutes, offline: !!r.offline, tint: r.tint, trackCount: r.trackCount,
    // Placeholder sleeve (tint) sits under the artwork so a missing file never shows a hole.
    sleeve: r.art ? `url("${artUrl(r.art)}") center/cover no-repeat, ${r.tint}` : `linear-gradient(135deg, ${r.tint}, #111211)`,
    sleeveText: r.art ? undefined : r.title.slice(0, 18).toUpperCase(), sleeveTextColor: '#EDEDE8'
  }))
}

function folders(): string[] {
  return (db.prepare('select path from folders order by path').all() as Array<{ path: string }>).map((r) => r.path)
}

function startWatching(): void {
  void watcher?.close()
  const roots = folders()
  if (!roots.length) return
  const queue = new Map<string, 'upsert' | 'remove'>()
  let timer: NodeJS.Timeout | undefined
  // Debounced: a folder copy fires thousands of events; we coalesce them into one batch.
  const kick = (): void => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const batch = [...queue]
      queue.clear()
      for (const [p, kind] of batch) {
        try {
          if (kind === 'remove') indexer.removeFile(p)
          else if (!(await fs.lstat(p)).isSymbolicLink()) await indexer.indexFile(p) // links would double-count the target
        } catch {
          /* vanished again: next event will fix it */
        }
      }
      post({ event: 'changed' })
    }, 500)
  }
  watcher = chokidar.watch(roots, { ignoreInitial: true, followSymlinks: false, /* symlink loops would re-add the library under new paths */ awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 }, ignored: (p, s) => !!s?.isFile() && !isAudioPath(p) })
  watcher.on('add', (p) => (queue.set(p, 'upsert'), kick()))
  watcher.on('change', (p) => (queue.set(p, 'upsert'), kick()))
  watcher.on('unlink', (p) => (queue.set(p, 'remove'), kick()))
  watcher.on('error', () => undefined) // permission errors on subfolders must not kill the worker
}

async function scanAll(): Promise<void> {
  if (scanning) return scanning
  scanning = (async () => {
    const denied: string[] = []
    const roots = folders()
    post({ event: 'progress', progress: { phase: 'scanning', done: 0, total: 0, denied } })
    for (const root of roots) {
      const r = await indexer.scanFolder(root, (done, total) => post({ event: 'progress', progress: { phase: 'scanning', done, total, denied } }))
      denied.push(...r.denied)
    }
    post({ event: 'progress', progress: { phase: 'idle', done: 0, total: 0, denied } })
    post({ event: 'changed' })
    startWatching()
  })().finally(() => { scanning = null })
  return scanning
}

async function handle(req: LibraryRequest): Promise<unknown> {
  switch (req.op) {
    case 'init': {
      mkdirSync(req.artDir, { recursive: true })
      const opened = openDb(req.dbPath)
      db = opened.db
      indexer = createIndexer(db, req.artDir)
      startWatching()
      return { recoveredFrom: opened.recovered }
    }
    case 'folders': return folders()
    case 'addFolder': db.prepare('insert or ignore into folders (path) values (?)').run(req.path); return null
    case 'removeFolder': db.prepare('delete from folders where path = ?').run(req.path); return null
    case 'scan': void scanAll(); return null
    case 'albums': return albumRows()
    case 'albumTracks':
      return db.prepare('select id, path, title, artist, album, disc, track, duration as durationSec from tracks where album_id = ? and missing = 0 order by disc, track, path').all(req.albumId) as LibraryTrack[]
    case 'search': {
      const m = ftsQuery(req.query)
      if (!m) return []
      return albumRows('where id in (select album_id from tracks where id in (select rowid from tracks_fts where tracks_fts match ?))', m)
    }
  }
}

process.parentPort.on('message', async (e) => {
  const { id, req } = e.data as { id: number; req: LibraryRequest }
  try {
    post({ id, ok: true, data: await handle(req) })
  } catch (err) {
    post({ id, ok: false, error: (err as Error).message })
  }
})
