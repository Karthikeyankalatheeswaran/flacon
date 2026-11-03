// Library worker (utilityProcess): scanning, tag parsing, artwork, SQLite, watching.
// Main holds no heavy work; it just proxies requests and forwards progress.
import { mkdirSync, promises as fs } from 'node:fs'
import chokidar, { type FSWatcher } from 'chokidar'
import { isAudioPath } from '@shared/playback'
import { artUrl, placeholderSleeve, type Album, type HomeData, type LibraryRequest, type LibrarySong, type LibraryTrack, type Playlist, type SongsPage, type SongsQuery, type StatsData } from '@shared/library'
import { SMART, SCOPE_RE, smartById } from '@shared/smart'
import { ftsQuery } from '@shared/tags'
import { groupLevel, likeUnder, type FolderListing, type FolderTrack } from '@shared/folders'
import { openDb, type Db } from './db'
import { createIndexer, type Indexer } from './indexer'
import { createAnalyzer, type Analyzer } from './analyzer'
import { readLyrics } from './lyricsRead'

let db: Db
let indexer: Indexer
let analyzer: Analyzer | null = null
let watcher: FSWatcher | null = null
let scanning: Promise<void> | null = null

const post = (m: unknown): void => process.parentPort.postMessage(m)

function albumRows(where = '', params: unknown[] = [], limit?: number): Album[] {
  const rows = db.prepare(`select id, title, album_artist as artist, art, tint, quality, ceiling, minutes, offline, track_count as trackCount, purity from albums ${where} order by added_at desc, id desc${limit ? ` limit ${Math.floor(limit)}` : ''}`).all(...params) as Array<{
    id: number; title: string; artist: string; art: string | null; tint: string; quality: Album['quality']; ceiling: number; minutes: number; offline: number; trackCount: number; purity: number | null
  }>
  return rows.map((r) => ({
    id: String(r.id), title: r.title, artist: r.artist, quality: r.quality, ceilingKhz: Math.round(r.ceiling * 100) / 100, minutes: r.minutes, offline: !!r.offline, tint: r.tint, trackCount: r.trackCount,
    purity: r.purity,
    // Placeholder sleeve (tint) sits under the artwork so a missing file never shows a hole.
    sleeve: r.art ? `url("${artUrl(r.art)}") center/cover no-repeat, ${r.tint}` : placeholderSleeve(r.tint),
    artUrl: r.art ? artUrl(r.art) : null,
  }))
}

// Sort columns are whitelisted (never interpolate user input into SQL). `lower()` gives a stable
// case-insensitive order; ties break on album/disc/track so equal titles keep a sensible order.
const SORT_SQL: Record<SongsQuery['sort'], string> = {
  title: 't.title collate nocase',
  artist: 't.artist collate nocase',
  album: 't.album collate nocase',
  duration: 't.duration',
  quality: "case t.quality when 'hires' then 2 when 'cd' then 1 else 0 end",
  added: 't.added_at',
  purity: 'coalesce(t.purity, -1)',
  plays: 't.play_count',
  lastPlayed: 't.last_played',
  rating: 't.rating',
  position: 'pt.pos'
}

const SONG_COLS = `t.id, t.path, t.title, t.artist, t.album, t.duration as durationSec, t.quality, t.sample_rate as sampleRate, t.bit_depth as bitDepth, t.codec, t.missing,
  t.lossless, t.purity, t.ceiling_hz as ceilingHz, t.eff_bits as effBits, t.upscaled, t.favorite, t.rating, t.play_count as playCount, t.last_played as lastPlayed,
  t.added_at as addedAt, t.gain_db as gainDb, t.peak, a.art, a.tint`

interface SongRow {
  id: number; path: string; title: string; artist: string; album: string; durationSec: number; quality: LibrarySong['quality']; sampleRate: number; bitDepth: number | null; codec: string
  missing: number; lossless: number; purity: number | null; ceilingHz: number | null; effBits: number | null; upscaled: number; favorite: number; rating: number; playCount: number
  lastPlayed: number; addedAt: number; gainDb: number | null; peak: number | null; art: string | null; tint: string; pos?: number; duplicate?: number
}

function toSong(r: SongRow): LibrarySong {
  return {
    id: r.id, path: r.path, title: r.title, artist: r.artist, album: r.album, durationSec: r.durationSec,
    quality: r.upscaled ? 'upscaled' : r.quality, sampleRate: r.sampleRate, bitDepth: r.bitDepth, codec: r.codec, offline: !!r.missing,
    sleeve: r.art ? `url("${artUrl(r.art)}") center/cover no-repeat, ${r.tint}` : placeholderSleeve(r.tint),
    artUrl: r.art ? artUrl(r.art) : null, duplicate: !!r.duplicate, lossless: !!r.lossless, purity: r.purity === null ? null : Math.round(r.purity),
    ceilingKhz: r.ceilingHz === null ? null : Math.round(r.ceilingHz / 100) / 10, effBits: r.effBits, upscaled: !!r.upscaled, favorite: !!r.favorite, rating: r.rating,
    playCount: r.playCount, lastPlayed: r.lastPlayed, addedAt: r.addedAt, gainDb: r.gainDb, peak: r.peak, ...(r.pos !== undefined ? { pos: r.pos } : {})
  }
}

/** Filter + join for a list scope. Smart lists are plain filters over the one tracks table. */
function scopeParts(scope: string | undefined): { join: string; where: string[]; args: unknown[] } {
  const none = { join: '', where: [] as string[], args: [] as unknown[] }
  if (!scope || scope === 'all' || !SCOPE_RE.test(scope)) return none
  if (scope.startsWith('playlist:')) return { join: 'join playlist_tracks pt on pt.path = t.path and pt.playlist_id = ?', where: [], args: [Number(scope.slice(9))] }
  switch (scope) {
    case 'favorites': return { ...none, where: ['t.favorite = 1'] }
    case 'recent': return { ...none, where: ['t.last_played > 0'] }
    case 'played': return { ...none, where: ['t.play_count > 0'] }
    case 'verified': return { ...none, where: ['t.lossless = 1', 't.purity >= 95', 't.upscaled = 0'] }
    case 'month': return { ...none, where: ['t.added_at >= ?'], args: [Date.now() - 30 * 86_400_000] }
    case 'upscaled': return { ...none, where: ['t.upscaled = 1'] }
    default: return none
  }
}

function defaultSort(scope: string): { sort: SongsQuery['sort']; dir: 'asc' | 'desc' } {
  if (scope.startsWith('playlist:')) return { sort: 'position', dir: 'asc' }
  const d = smartById(scope)
  return d ? { sort: d.sort, dir: d.dir } : { sort: 'title', dir: 'asc' }
}

function songs(q: SongsQuery): SongsPage {
  const m = ftsQuery(q.text)
  const sc = scopeParts(q.scope)
  const where = [...sc.where, ...(m ? ['t.id in (select rowid from tracks_fts where tracks_fts match ?)'] : [])]
  const ordered = [...sc.args, ...(m ? [m] : [])] // placeholders: join (playlist id) or where (month cutoff), then the FTS match
  const w = where.length ? `where ${where.join(' and ')}` : ''
  const base = `from tracks t join albums a on a.id = t.album_id ${sc.join} ${w}`
  const total = (db.prepare(`select count(*) n ${base}`).get(...ordered) as { n: number }).n
  const dir = q.dir === 'desc' ? 'desc' : 'asc'
  const sortKey = q.sort === 'position' && !sc.join ? 'title' : q.sort
  const posCol = sc.join ? ', pt.pos as pos' : ''
  const rows = db.prepare(`select ${SONG_COLS}${posCol},
      exists (select 1 from tracks d where d.id != t.id and d.title = t.title and d.artist = t.artist and abs(d.duration - t.duration) < 1) as duplicate
    ${base} order by ${SORT_SQL[sortKey]} ${dir}, t.album collate nocase, t.disc, t.track, t.id limit ? offset ?`).all(...ordered, q.limit, q.offset) as SongRow[]
  return { total, rows: rows.map(toSong) }
}

function trackMetas(paths: string[]): LibrarySong[] {
  const rows = db.prepare(`select ${SONG_COLS} from tracks t join albums a on a.id = t.album_id where t.path in (select value from json_each(?))`).all(JSON.stringify(paths)) as SongRow[]
  return rows.map(toSong)
}

function oneSong(path: string): LibrarySong | null {
  return trackMetas([path])[0] ?? null
}

function playlistPaths(id: number): string[] {
  return (db.prepare('select path from playlist_tracks where playlist_id = ? order by pos').all(id) as Array<{ path: string }>).map((r) => r.path)
}

/** Replace a playlist's rows (positions are always 0..n-1). Playlists are small; rewriting keeps them gap-free. */
function playlistWrite(id: number, paths: string[]): void {
  db.transaction(() => {
    db.prepare('delete from playlist_tracks where playlist_id = ?').run(id)
    const ins = db.prepare('insert into playlist_tracks (playlist_id, pos, path) values (?, ?, ?)')
    paths.slice(0, 20_000).forEach((p, i) => ins.run(id, i, p))
    db.prepare('update playlists set updated_at = ? where id = ?').run(Date.now(), id)
  })()
}

function playlists(): Playlist[] {
  const rows = db.prepare(`select p.id, p.name, p.updated_at as updatedAt,
      (select count(*) from playlist_tracks x where x.playlist_id = p.id) as tracks,
      (select coalesce(sum(t.duration), 0) from playlist_tracks x join tracks t on t.path = x.path where x.playlist_id = p.id) as secs,
      (select a.art from playlist_tracks x join tracks t on t.path = x.path join albums a on a.id = t.album_id where x.playlist_id = p.id and a.art is not null order by x.pos limit 1) as art
    from playlists p order by p.updated_at desc, p.id desc`).all() as Array<{ id: number; name: string; updatedAt: number; tracks: number; secs: number; art: string | null }>
  return rows.map((r) => ({ id: r.id, name: r.name, tracks: r.tracks, minutes: Math.round(r.secs / 60), updatedAt: r.updatedAt,
    sleeve: r.art ? `url("${artUrl(r.art)}") center/cover no-repeat, #262725` : placeholderSleeve('#3a3d3a') }))
}

function home(): HomeData {
  const ids = (db.prepare('select album_id as id from tracks where last_played > 0 group by album_id order by max(last_played) desc limit 12').all() as Array<{ id: number }>).map((r) => r.id)
  const byId = new Map(albumRows(`where id in (${ids.map(() => '?').join(',') || 'null'})`, ids).map((a) => [a.id, a]))
  const sel = (where: string, order: string): LibrarySong[] => (db.prepare(`select ${SONG_COLS} from tracks t join albums a on a.id = t.album_id where ${where} order by ${order} limit 10`).all() as SongRow[]).map(toSong)
  const c = db.prepare("select count(*) total, sum(lossless = 1 and analyzed = 1 and purity is not null) measured, sum(upscaled) ups, avg(purity) avg from tracks where missing = 0").get() as { total: number; measured: number | null; ups: number | null; avg: number | null }
  return {
    jumpBackIn: ids.map((i) => byId.get(String(i))).filter((a): a is Album => !!a),
    recentlyAdded: albumRows('', [], 12),
    onRepeat: sel('t.play_count > 0', 't.play_count desc, t.last_played desc'),
    forgotten: sel(`t.favorite = 1 and t.last_played < ${Date.now() - 60 * 86_400_000}`, 't.last_played asc'),
    review: { upscaled: c.ups ?? 0, measured: c.measured ?? 0, total: c.total, avgPurity: c.avg === null ? null : Math.round(c.avg) }
  }
}

function stats(): StatsData {
  const one = <T,>(sql: string): T => db.prepare(sql).get() as T
  const t = one<{ n: number; secs: number | null }>('select count(*) n, sum(duration) secs from tracks where missing = 0')
  const pl = one<{ n: number; secs: number | null }>('select count(*) n, sum(secs) secs from plays')
  const rows = <T,>(sql: string): T[] => db.prepare(sql).all() as T[]
  const buckets = one<{ pure: number | null; good: number | null; limited: number | null; thin: number | null; lossy: number | null; unmeasured: number | null; measured: number | null; lossless: number | null }>(
    `select sum(lossless = 1 and purity >= 95) pure, sum(lossless = 1 and purity >= 75 and purity < 95) good, sum(lossless = 1 and purity >= 50 and purity < 75) limited,
      sum(lossless = 1 and purity < 50) thin, sum(lossless = 0) lossy, sum(lossless = 1 and purity is null) unmeasured, sum(lossless = 1 and purity is not null) measured, sum(lossless = 1) lossless
     from tracks where missing = 0`)
  const wk = Array<number>(7).fill(0)
  for (const r of rows<{ d: string; n: number }>("select strftime('%w', played_at / 1000, 'unixepoch', 'localtime') d, count(*) n from plays group by d")) wk[Number(r.d)] = r.n
  const hr = Array<number>(24).fill(0)
  for (const r of rows<{ h: string; n: number }>("select strftime('%H', played_at / 1000, 'unixepoch', 'localtime') h, count(*) n from plays group by h")) hr[Number(r.h)] = r.n
  return {
    songs: t.n, albums: one<{ n: number }>('select count(*) n from albums').n, artists: one<{ n: number }>('select count(distinct album_artist) n from albums').n,
    hoursOfMusic: Math.round(((t.secs ?? 0) / 3600) * 10) / 10, plays: pl.n, hoursListened: Math.round(((pl.secs ?? 0) / 3600) * 10) / 10,
    topArtists: rows('select t.artist name, count(*) plays from plays p join tracks t on t.path = p.path group by t.artist order by plays desc, name limit 5'),
    topSongs: rows('select t.title, t.artist, t.path, count(*) plays from plays p join tracks t on t.path = p.path group by t.id order by plays desc, t.title limit 5'),
    topAlbums: rows('select a.title, a.album_artist artist, count(*) plays from plays p join tracks t on t.path = p.path join albums a on a.id = t.album_id group by a.id order by plays desc, a.title limit 5'),
    byWeekday: wk, byHour: hr,
    purity: { pure: buckets.pure ?? 0, good: buckets.good ?? 0, limited: buckets.limited ?? 0, thin: buckets.thin ?? 0, lossy: buckets.lossy ?? 0, unmeasured: buckets.unmeasured ?? 0 },
    measured: buckets.measured ?? 0, lossless: buckets.lossless ?? 0
  }
}

function folderListing(dir: string | null): FolderListing {
  if (dir === null) {
    // Top level: each library root with its track count.
    const dirs = folders().map((p) => ({ name: p, path: p, tracks: (db.prepare("select count(*) n from tracks where path like ? escape '\\' and missing = 0").get(likeUnder(p)) as { n: number }).n }))
    return { dir: null, dirs, tracks: [] }
  }
  // Only browse inside registered library folders.
  const rows = db.prepare("select id, path, title, artist, duration as durationSec from tracks where path like ? escape '\\' and missing = 0").all(likeUnder(dir)) as FolderTrack[]
  return { dir, ...groupLevel(dir, rows) }
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
  watcher = chokidar.watch(roots, { ignoreInitial: true, followSymlinks: false, /* symlink loops would re-add the library under new paths */ awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 }, ignored: (p, s) => !!s?.isFile() && !isAudioPath(p) && !p.toLowerCase().endsWith('.cue') })
  // A sheet appearing, changing or vanishing changes how its audio is sliced: rescan rather than patch.
  const isCue = (p: string): boolean => p.toLowerCase().endsWith('.cue')
  let rescan: NodeJS.Timeout | undefined
  const rescanSoon = (): void => { clearTimeout(rescan); rescan = setTimeout(() => void scanAll(), 1500) }
  watcher.on('add', (p) => (isCue(p) ? rescanSoon() : (queue.set(p, 'upsert'), kick())))
  watcher.on('change', (p) => (isCue(p) ? rescanSoon() : (queue.set(p, 'upsert'), kick())))
  watcher.on('unlink', (p) => (isCue(p) ? rescanSoon() : (queue.set(p, 'remove'), kick())))
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
    analyzer?.kick()
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
      analyzer = createAnalyzer(db, req.ffmpeg, (ids) => {
        for (const id of ids) indexer.refreshAlbum(id)
        post({ event: 'analysis', progress: analyzer!.progress() })
      })
      startWatching()
      analyzer.kick()
      return { recoveredFrom: opened.recovered }
    }
    case 'folders': return folders()
    case 'addFolder': db.prepare('insert or ignore into folders (path) values (?)').run(req.path); return null
    case 'removeFolder':
      db.prepare('delete from folders where path = ?').run(req.path)
      indexer.removeUnder(req.path)
      startWatching()
      post({ event: 'changed' })
      return null
    case 'scan': void scanAll(); return null
    case 'albums': return albumRows()
    case 'albumTracks':
      return db.prepare('select id, path, title, artist, album, disc, track, duration as durationSec from tracks where album_id = ? and missing = 0 order by disc, track, path').all(req.albumId) as LibraryTrack[]
    case 'songs': return songs(req.query)
    case 'folder': return folderListing(req.dir)
    case 'cueRefs':
      return db.prepare('select path, title, cue_start as startSec, cue_end as endSec from tracks where cue_start is not null and path in (select value from json_each(?))').all(JSON.stringify(req.paths))
    case 'trackMetas': return trackMetas(req.paths)
    case 'setFavorite': db.prepare('update tracks set favorite = ? where path = ?').run(req.value ? 1 : 0, req.path); post({ event: 'activity' }); return oneSong(req.path)
    case 'setRating': db.prepare('update tracks set rating = ? where path = ?').run(Math.max(0, Math.min(5, Math.round(req.value))), req.path); post({ event: 'activity' }); return oneSong(req.path)
    case 'recordPlay': {
      const now = Date.now()
      db.transaction(() => {
        db.prepare('insert into plays (path, played_at, secs) values (?, ?, ?)').run(req.path, now, Math.max(0, req.secs))
        db.prepare('update tracks set play_count = play_count + 1, last_played = ? where path = ?').run(now, req.path)
      })()
      post({ event: 'activity' })
      return null
    }
    case 'playlists': return playlists()
    case 'playlistCreate': {
      const now = Date.now()
      const id = Number(db.prepare('insert into playlists (name, created_at, updated_at) values (?, ?, ?)').run(req.name.trim().slice(0, 120) || 'Untitled playlist', now, now).lastInsertRowid)
      if (req.paths.length) playlistWrite(id, req.paths)
      post({ event: 'activity' })
      return id
    }
    case 'playlistRename': db.prepare('update playlists set name = ?, updated_at = ? where id = ?').run(req.name.trim().slice(0, 120) || 'Untitled playlist', Date.now(), req.id); post({ event: 'activity' }); return null
    case 'playlistDelete': db.prepare('delete from playlists where id = ?').run(req.id); post({ event: 'activity' }); return null
    case 'playlistAdd': playlistWrite(req.id, [...playlistPaths(req.id), ...req.paths]); post({ event: 'activity' }); return null
    case 'playlistRemove': {
      const drop = new Set(req.positions)
      playlistWrite(req.id, playlistPaths(req.id).filter((_, i) => !drop.has(i)))
      post({ event: 'activity' })
      return null
    }
    case 'playlistMove': {
      const p = playlistPaths(req.id)
      if (req.from < 0 || req.from >= p.length || req.to < 0 || req.to >= p.length) return null
      const [x] = p.splice(req.from, 1)
      p.splice(req.to, 0, x!)
      playlistWrite(req.id, p)
      post({ event: 'activity' })
      return null
    }
    case 'playlistPaths': return playlistPaths(req.id)
    case 'playlistImport': {
      const known = new Set((db.prepare('select path from tracks where path in (select value from json_each(?))').all(JSON.stringify(req.paths)) as Array<{ path: string }>).map((r) => r.path))
      const matched = req.paths.filter((p) => known.has(p))
      const now = Date.now()
      const id = Number(db.prepare('insert into playlists (name, created_at, updated_at) values (?, ?, ?)').run(req.name.trim().slice(0, 120) || 'Imported playlist', now, now).lastInsertRowid)
      playlistWrite(id, matched)
      post({ event: 'activity' })
      return { id, matched: matched.length, total: req.paths.length }
    }
    case 'scopePaths': {
      const sc = req.scope && SCOPE_RE.test(req.scope) ? req.scope : 'all'
      const d = defaultSort(sc)
      return songs({ sort: d.sort, dir: d.dir, text: req.text, scope: sc, offset: 0, limit: Math.min(5000, req.limit) }).rows.filter((r) => !r.offline).map((r) => r.path)
    }
    case 'albumPaths':
      return (db.prepare("select path from tracks where missing = 0 and album_id in (select value from json_each(?)) order by album_id, disc, track, path").all(JSON.stringify(req.albumIds)) as Array<{ path: string }>).map((r) => r.path)
    case 'artistPaths':
      return (db.prepare("select path from tracks where missing = 0 and (album_artist = ? or artist = ?) order by album collate nocase, disc, track, path limit 5000").all(req.artist, req.artist) as Array<{ path: string }>).map((r) => r.path)
    case 'lyrics': return readLyrics(req.path)
    case 'home': return home()
    case 'stats': return stats()
    case 'analysisProgress': return analyzer?.progress() ?? { done: 0, total: 0 }
    case 'search': {
      const m = ftsQuery(req.query)
      if (!m) return []
      return albumRows('where id in (select album_id from tracks where id in (select rowid from tracks_fts where tracks_fts match ?))', [m])
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
