import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { parseFile } from 'music-metadata'
import { betterQuality, albumKey, cleanString, hueTint, inferQuality, normalizeTags, parseNumberOf, splitMulti } from '@shared/tags'
import type { Quality } from '@shared/library'
import type { Db } from './db'
import { walk } from './walk'

const MAX_ART_BYTES = 20 * 1024 * 1024 // huge embedded artwork (20 MB+) is ignored; folder art is tried instead
const FOLDER_ART = ['cover', 'folder', 'front', 'album']
const ART_EXT = ['jpg', 'jpeg', 'png', 'webp']

export interface Indexer {
  scanFolder(root: string, onProgress: (done: number, total: number) => void): Promise<{ denied: string[]; reachable: boolean }>
  indexFile(path: string): Promise<void>
  removeFile(path: string): void
}

export function createIndexer(db: Db, artDir: string): Indexer {
  const q = {
    byPath: db.prepare('select id, size, mtime, album_id as albumId from tracks where path = ?'),
    movedCandidates: db.prepare('select id, path, album_id as albumId from tracks where size = ? and title = ? and album = ? and abs(duration - ?) < 0.05 and path != ?'),
    upsertAlbum: db.prepare(`insert into albums (key, title, album_artist, year, tint, quality, added_at) values (@key, @title, @albumArtist, @year, @tint, @quality, @now)
      on conflict(key) do update set year = max(year, excluded.year),
        title = case when (case excluded.quality when 'hires' then 2 when 'cd' then 1 else 0 end) > (case albums.quality when 'hires' then 2 when 'cd' then 1 else 0 end) then excluded.title else albums.title end
      returning id`),
    insertTrack: db.prepare(`insert into tracks (path, size, mtime, title, artist, album_artist, album, composer, album_id, disc, disc_total, track, track_total, year, genre, duration,
      sample_rate, bit_depth, channels, codec, lossless, quality, added_at) values (@path, @size, @mtime, @title, @artist, @albumArtist, @album, @composer, @albumId, @disc, @discTotal, @track, @trackTotal,
      @year, @genre, @duration, @sampleRate, @bitDepth, @channels, @codec, @lossless, @quality, @now)`),
    updateTrack: db.prepare(`update tracks set path=@path, size=@size, mtime=@mtime, title=@title, artist=@artist, album_artist=@albumArtist, album=@album, composer=@composer, album_id=@albumId,
      disc=@disc, disc_total=@discTotal, track=@track, track_total=@trackTotal, year=@year, genre=@genre, duration=@duration, sample_rate=@sampleRate, bit_depth=@bitDepth, channels=@channels,
      codec=@codec, lossless=@lossless, quality=@quality, missing=0 where id=@id`),
    ftsDelete: db.prepare('delete from tracks_fts where rowid = ?'),
    ftsInsert: db.prepare('insert into tracks_fts (rowid, title, artist, album, composer) values (?, ?, ?, ?, ?)'),
    delTrack: db.prepare('delete from tracks where id = ?'),
    idByPath: db.prepare('select id, album_id as albumId from tracks where path = ?'),
    aggregate: db.prepare(`select count(*) n, sum(duration) dur, max(case quality when 'hires' then 2 when 'cd' then 1 else 0 end) rank, max(sample_rate) rate,
      sum(missing = 0) present from tracks where album_id = ?`),
    setAggregate: db.prepare('update albums set minutes=@minutes, track_count=@n, quality=@quality, ceiling=@ceiling, offline=@offline where id=@id'),
    albumArt: db.prepare('update albums set art = coalesce(art, ?) where id = ?'),
    delEmptyAlbums: db.prepare('delete from albums where id not in (select distinct album_id from tracks)'),
    underRoot: db.prepare("select id, path, album_id as albumId from tracks where path like ? escape '\\'")
  }

  const touched = new Set<number>()

  async function saveArt(data: Uint8Array, mime: string): Promise<string | null> {
    if (data.byteLength > MAX_ART_BYTES) return null
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg'
    const name = `${createHash('sha1').update(data).digest('hex')}.${ext}`
    const target = join(artDir, name)
    if (!existsSync(target)) await fs.writeFile(target, data)
    return name
  }

  async function folderArt(dir: string): Promise<string | null> {
    try {
      const names = await fs.readdir(dir)
      for (const base of FOLDER_ART) {
        const hit = names.find((n) => n.toLowerCase().startsWith(base + '.') && ART_EXT.includes(extname(n).slice(1).toLowerCase()))
        if (hit) {
          const buf = await fs.readFile(join(dir, hit))
          return saveArt(buf, `image/${extname(hit).slice(1).toLowerCase()}`)
        }
      }
    } catch {
      /* unreadable folder: no art */
    }
    return null
  }

  function refreshAlbum(id: number): void {
    const a = q.aggregate.get(id) as { n: number; dur: number | null; rank: number | null; rate: number | null; present: number | null }
    if (!a.n) return
    const quality: Quality = a.rank === 2 ? 'hires' : a.rank === 1 ? 'cd' : 'lossy'
    q.setAggregate.run({ id, n: a.n, minutes: Math.round((a.dur ?? 0) / 60), quality, ceiling: (a.rate ?? 0) / 2000, offline: a.present ? 0 : 1 })
  }

  async function indexFile(path: string): Promise<void> {
    const st = await fs.stat(path)
    const existing = q.byPath.get(path) as { id: number; size: number; mtime: number; albumId: number } | undefined
    if (existing && existing.size === st.size && existing.mtime === Math.floor(st.mtimeMs)) {
      touched.add(existing.albumId) // may have been marked missing earlier
      return
    }
    let meta
    try {
      meta = await parseFile(path, { duration: true, skipPostHeaders: true })
    } catch {
      return // corrupt/unreadable: leave it out of the library rather than poison it
    }
    const c = meta.common
    const f = meta.format
    const n = normalizeTags({ title: c.title, artist: c.artist, artists: c.artists, albumartist: c.albumartist, album: c.album, year: c.year, genre: c.genre, compilation: !!c.compilation }, path)
    const quality = inferQuality({ lossless: !!f.lossless, bitDepth: f.bitsPerSample ?? null, sampleRate: f.sampleRate ?? 44100 })
    const key = albumKey(n.albumArtist, n.album)
    const now = Date.now()
    const disc = parseNumberOf(c.disk)
    const trk = parseNumberOf(c.track)
    const duration = f.duration ?? 0
    const composer = splitMulti(c.composer).join(', ')

    let artName: string | null = null
    const pic = c.picture?.[0]
    if (pic) artName = await saveArt(pic.data, pic.format)
    if (!artName) artName = await folderArt(dirname(path))

    db.transaction(() => {
      const albumId = (q.upsertAlbum.get({ key, title: n.album, albumArtist: n.albumArtist, year: n.year, tint: hueTint(key), quality, now }) as { id: number }).id
      const row = { path, size: st.size, mtime: Math.floor(st.mtimeMs), title: n.title, artist: n.artist, albumArtist: n.albumArtist, album: n.album, composer, albumId,
        disc: disc.no, discTotal: disc.of, track: trk.no, trackTotal: trk.of, year: n.year, genre: n.genre, duration, sampleRate: f.sampleRate ?? 0,
        bitDepth: f.bitsPerSample ?? null, channels: f.numberOfChannels ?? 2, codec: cleanString(f.codec) || (f.container ?? ''), lossless: f.lossless ? 1 : 0, quality, now }
      let id = existing?.id
      let oldAlbum = existing?.albumId
      if (!id) {
        // A moved/renamed file keeps its identity (play count) when size + duration + tags still match
        // and the old path is gone.
        const moved = (q.movedCandidates.all(st.size, n.title, n.album, duration, path) as Array<{ id: number; path: string; albumId: number }>).find((m) => !existsSync(m.path))
        if (moved) {
          id = moved.id
          oldAlbum = moved.albumId
        }
      }
      if (id) {
        q.updateTrack.run({ ...row, id })
        q.ftsDelete.run(id)
      } else id = Number(q.insertTrack.run(row).lastInsertRowid)
      q.ftsInsert.run(id, n.title, n.artist, n.album, composer)
      if (artName) q.albumArt.run(artName, albumId)
      touched.add(albumId)
      if (oldAlbum && oldAlbum !== albumId) touched.add(oldAlbum)
    })()
  }

  function removeFile(path: string): void {
    const row = q.idByPath.get(path) as { id: number; albumId: number } | undefined
    if (!row) return
    db.transaction(() => {
      q.ftsDelete.run(row.id)
      q.delTrack.run(row.id)
      touched.add(row.albumId)
    })()
    flush()
  }

  function flush(): void {
    db.transaction(() => {
      for (const id of touched) refreshAlbum(id)
      q.delEmptyAlbums.run()
    })()
    touched.clear()
  }

  async function scanFolder(root: string, onProgress: (done: number, total: number) => void): Promise<{ denied: string[]; reachable: boolean }> {
    const w = await walk(root)
    const like = root.replace(/[\\%_]/g, '\\$&') + '%'
    const known = q.underRoot.all(like) as Array<{ id: number; path: string; albumId: number }>
    if (!w.rootReachable) {
      // Drive offline / folder renamed or removed: keep everything, just flag it unavailable.
      db.transaction(() => {
        for (const k of known) {
          db.prepare('update tracks set missing = 1 where id = ?').run(k.id)
          touched.add(k.albumId)
        }
      })()
      flush()
      return { denied: [], reachable: false }
    }
    let done = 0
    for (const p of w.files) {
      try {
        await indexFile(p)
      } catch {
        /* file vanished mid-scan or unreadable: skip */
      }
      onProgress(++done, w.files.length)
      if (done % 200 === 0) flush() // batch SQLite work; keeps the UI filling in as the scan proceeds
      if (done % 25 === 0) await new Promise((r) => setImmediate(r)) // let the worker answer queries
    }
    const present = new Set(w.files)
    for (const k of known) if (!present.has(k.path)) removeFile(k.path)
    flush()
    return { denied: w.denied, reachable: true }
  }

  return { scanFolder, indexFile: async (p) => { await indexFile(p); flush() }, removeFile }
}
