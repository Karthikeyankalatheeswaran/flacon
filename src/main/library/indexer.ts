import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, join, sep } from 'node:path'
import { parseFile } from 'music-metadata'
import { betterQuality, albumKey, cleanString, hueTint, inferQuality, normalizeTags, parseNumberOf, splitMulti } from '@shared/tags'
import type { Quality } from '@shared/library'
import { cueVirtualPath, decodeCue, parseCue, trackEnds } from '@shared/cue'
import type { Db } from './db'
import { walk } from './walk'

const MAX_ART_BYTES = 20 * 1024 * 1024 // huge embedded artwork (20 MB+) is ignored; folder art is tried instead
const FOLDER_ART = ['cover', 'folder', 'front', 'album']
const ART_EXT = ['jpg', 'jpeg', 'png', 'webp']

export interface Indexer {
  scanFolder(root: string, onProgress: (done: number, total: number) => void): Promise<{ denied: string[]; reachable: boolean }>
  indexFile(path: string): Promise<void>
  /** Index every track of a .cue sheet. Returns the audio files it covers and the virtual paths it produced. */
  indexCue(cuePath: string, audio: Set<string>): Promise<{ covered: string[]; paths: string[] }>
  removeFile(path: string): void
  /** Drop every track under `root` in one transaction (a library folder was removed). */
  removeUnder(root: string): void
  /** Recompute an album's aggregate row (quality, purity) after its tracks changed. */
  refreshAlbum(id: number): void
}

/** LIKE pattern for "everything inside `root`": the separator is included so /music doesn't also match /music2. */
function underRootPattern(root: string): string {
  const esc = (v: string): string => v.replace(/[\\%_]/g, '\\$&')
  return esc(root.replace(/[\\/]+$/, '')) + esc(sep) + '%'
}

const finite = (v: number | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function createIndexer(db: Db, artDir: string): Indexer {
  const q = {
    byPath: db.prepare('select id, size, mtime, album_id as albumId from tracks where path = ?'),
    movedCandidates: db.prepare('select id, path, album_id as albumId from tracks where size = ? and title = ? and album = ? and abs(duration - ?) < 0.05 and path != ?'),
    upsertAlbum: db.prepare(`insert into albums (key, title, album_artist, year, tint, quality, added_at) values (@key, @title, @albumArtist, @year, @tint, @quality, @now)
      on conflict(key) do update set year = max(year, excluded.year),
        title = case when (case excluded.quality when 'hires' then 2 when 'cd' then 1 else 0 end) > (case albums.quality when 'hires' then 2 when 'cd' then 1 else 0 end) then excluded.title else albums.title end
      returning id`),
    insertTrack: db.prepare(`insert into tracks (path, size, mtime, title, artist, album_artist, album, composer, album_id, disc, disc_total, track, track_total, year, genre, duration,
      sample_rate, bit_depth, channels, codec, lossless, quality, gain_db, peak, added_at) values (@path, @size, @mtime, @title, @artist, @albumArtist, @album, @composer, @albumId, @disc, @discTotal, @track, @trackTotal,
      @year, @genre, @duration, @sampleRate, @bitDepth, @channels, @codec, @lossless, @quality, @gainDb, @peak, @now)`),
    updateTrack: db.prepare(`update tracks set path=@path, size=@size, mtime=@mtime, title=@title, artist=@artist, album_artist=@albumArtist, album=@album, composer=@composer, album_id=@albumId,
      disc=@disc, disc_total=@discTotal, track=@track, track_total=@trackTotal, year=@year, genre=@genre, duration=@duration, sample_rate=@sampleRate, bit_depth=@bitDepth, channels=@channels,
      codec=@codec, lossless=@lossless, quality=@quality, gain_db=@gainDb, peak=@peak, analyzed=0, purity=null, upscaled=0, missing=0 where id=@id`),
    ftsDelete: db.prepare('delete from tracks_fts where rowid = ?'),
    ftsInsert: db.prepare('insert into tracks_fts (rowid, title, artist, album, composer) values (?, ?, ?, ?, ?)'),
    delTrack: db.prepare('delete from tracks where id = ?'),
    idByPath: db.prepare('select id, album_id as albumId from tracks where path = ?'),
    aggregate: db.prepare(`select count(*) n, sum(duration) dur, max(case quality when 'hires' then 2 when 'cd' then 1 else 0 end) rank, max(sample_rate) rate,
      sum(missing = 0) present, avg(purity) purity, sum(upscaled) ups from tracks where album_id = ?`),
    setAggregate: db.prepare('update albums set minutes=@minutes, track_count=@n, quality=@quality, ceiling=@ceiling, offline=@offline, purity=@purity where id=@id'),
    albumArt: db.prepare('update albums set art = coalesce(art, ?) where id = ?'),
    delEmptyAlbums: db.prepare('delete from albums where id not in (select distinct album_id from tracks)'),
    setCue: db.prepare('update tracks set cue_start = ?, cue_end = ? where id = ?'),
    cueCovers: db.prepare("select 1 from tracks where path like ? escape '\\' and cue_start is not null limit 1"),
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
    const a = q.aggregate.get(id) as { n: number; dur: number | null; rank: number | null; rate: number | null; present: number | null; purity: number | null; ups: number | null }
    if (!a.n) return
    const quality: Quality = (a.ups ?? 0) > 0 ? 'upscaled' : a.rank === 2 ? 'hires' : a.rank === 1 ? 'cd' : 'lossy'
    q.setAggregate.run({ id, n: a.n, minutes: Math.round((a.dur ?? 0) / 60), quality, ceiling: (a.rate ?? 0) / 2000, offline: a.present ? 0 : 1, purity: a.purity === null ? null : Math.round(a.purity) })
  }

  /** True when an audio file is the source of CUE-sliced tracks (it must not also be listed as one long track). */
  function coveredByCue(path: string): boolean {
    const esc = (v: string): string => v.replace(/[\\%_]/g, '\\$&')
    const ext = extname(path)
    return !!q.cueCovers.get(esc(path.slice(0, path.length - ext.length)) + '#cue%' + esc(ext))
  }

  /** Match a FILE name from a sheet to a real audio file beside it: only the base name is honoured (never ../), and a wrong extension (".wav" for a ".flac") is forgiven. */
  function resolveCueFile(dir: string, name: string, audio: Set<string>): string | null {
    const base = basename(name.replace(/\\/g, '/'))
    const exact = join(dir, base)
    if (audio.has(exact)) return exact
    const stem = base.slice(0, base.length - extname(base).length).toLowerCase()
    for (const a of audio) if (dirname(a) === dir && basename(a).slice(0, basename(a).length - extname(a).length).toLowerCase() === stem) return a
    return null
  }

  async function indexCue(cuePath: string, audio: Set<string>): Promise<{ covered: string[]; paths: string[] }> {
    const none = { covered: [], paths: [] }
    const cueStat = await fs.stat(cuePath)
    if (cueStat.size > 2 * 1024 * 1024) return none // not a real sheet
    const sheet = parseCue(decodeCue(await fs.readFile(cuePath)))
    if (!sheet.tracks.length) return none
    const dir = dirname(cuePath)
    const files = new Map<string, string | null>()
    for (const t of sheet.tracks) if (!files.has(t.file)) files.set(t.file, resolveCueFile(dir, t.file, audio))
    const metas = new Map<string, Awaited<ReturnType<typeof parseFile>>>()
    const sizes = new Map<string, { size: number; mtime: number }>()
    for (const real of new Set([...files.values()].filter((v): v is string => !!v))) {
      try {
        metas.set(real, await parseFile(real, { duration: true, skipPostHeaders: true }))
        const st = await fs.stat(real)
        sizes.set(real, { size: st.size, mtime: Math.floor(Math.max(st.mtimeMs, cueStat.mtimeMs)) })
      } catch {
        /* unreadable audio: its tracks are skipped */
      }
    }
    const usable = sheet.tracks.filter((t) => { const r = files.get(t.file); return r && metas.has(r) })
    if (!usable.length) return none
    const ends = trackEnds(usable.map((t) => ({ ...t, file: files.get(t.file)! })), (f) => metas.get(f)?.format.duration ?? 0)
    const out: string[] = []
    for (const [i, t] of usable.entries()) {
      const real = files.get(t.file)!
      const meta = metas.get(real)!
      const f = meta.format
      const c = meta.common
      const vpath = cueVirtualPath(real, t.number)
      out.push(vpath)
      const sz = sizes.get(real)!
      const existing = q.byPath.get(vpath) as { id: number; size: number; mtime: number; albumId: number } | undefined
      if (existing && existing.size === sz.size && existing.mtime === sz.mtime) {
        touched.add(existing.albumId)
        continue
      }
      const albumArtist = cleanString(sheet.performer) || cleanString(t.performer) || 'Unknown artist'
      const album = cleanString(sheet.title) || cleanString(c.album) || basename(real, extname(real))
      const artist = cleanString(t.performer) || albumArtist
      const title = cleanString(t.title) || `Track ${t.number}`
      const quality = inferQuality({ lossless: !!f.lossless, bitDepth: f.bitsPerSample ?? null, sampleRate: f.sampleRate ?? 44100 })
      const key = albumKey(albumArtist, album)
      let artName: string | null = null
      const pic = c.picture?.[0]
      if (pic) artName = await saveArt(pic.data, pic.format)
      if (!artName) artName = await folderArt(dir)
      const end = ends[i]!
      db.transaction(() => {
        const albumId = (q.upsertAlbum.get({ key, title: album, albumArtist, year: sheet.date, tint: hueTint(key), quality, now: Date.now() }) as { id: number }).id
        const row = { path: vpath, size: sz.size, mtime: sz.mtime, title, artist, albumArtist, album, composer: '', albumId, disc: 0, discTotal: 0, track: t.number, trackTotal: usable.length,
          year: sheet.date, genre: sheet.genre, duration: Math.max(0, end - t.startSec), sampleRate: f.sampleRate ?? 0, bitDepth: f.bitsPerSample ?? null, channels: f.numberOfChannels ?? 2,
          codec: cleanString(f.codec) || (f.container ?? ''), lossless: f.lossless ? 1 : 0, quality, gainDb: null, peak: null, now: Date.now() }
        let id = existing?.id
        if (id) {
          q.updateTrack.run({ ...row, id })
          q.ftsDelete.run(id)
        } else id = Number(q.insertTrack.run(row).lastInsertRowid)
        q.setCue.run(t.startSec, end, id)
        q.ftsInsert.run(id, title, artist, album, '')
        if (artName) q.albumArt.run(artName, albumId)
        touched.add(albumId)
        if (existing && existing.albumId !== albumId) touched.add(existing.albumId)
      })()
    }
    return { covered: [...new Set(usable.map((t) => files.get(t.file)!))], paths: out }
  }

  async function indexFile(path: string): Promise<void> {
    if (coveredByCue(path)) return
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
        bitDepth: f.bitsPerSample ?? null, channels: f.numberOfChannels ?? 2, codec: cleanString(f.codec) || (f.container ?? ''), lossless: f.lossless ? 1 : 0, quality,
        gainDb: finite(c.replaygain_track_gain?.dB), peak: finite(c.replaygain_track_peak?.ratio), now }
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
    const like = underRootPattern(root)
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
    // CUE sheets first: audio they cover is indexed as slices, not as one long track.
    const audioSet = new Set(w.files)
    const covered = new Set<string>()
    const cuePaths = new Set<string>()
    for (const cue of w.cues) {
      try {
        const r = await indexCue(cue, audioSet)
        r.covered.forEach((f) => covered.add(f))
        r.paths.forEach((v) => cuePaths.add(v))
      } catch {
        /* unreadable sheet: its audio falls back to whole-file tracks */
      }
    }
    const plain = w.files.filter((f) => !covered.has(f))
    let done = 0
    for (const p of plain) {
      try {
        await indexFile(p)
      } catch {
        /* file vanished mid-scan or unreadable: skip */
      }
      onProgress(++done, plain.length)
      if (done % 200 === 0) flush() // batch SQLite work; keeps the UI filling in as the scan proceeds
      if (done % 25 === 0) await new Promise((r) => setImmediate(r)) // let the worker answer queries
    }
    const present = new Set([...plain, ...cuePaths])
    for (const k of known) if (!present.has(k.path)) removeFile(k.path)
    flush()
    return { denied: w.denied, reachable: true }
  }

  function removeUnder(root: string): void {
    const like = underRootPattern(root)
    const rows = q.underRoot.all(like) as Array<{ id: number; albumId: number }>
    db.transaction(() => {
      for (const r of rows) {
        q.ftsDelete.run(r.id)
        q.delTrack.run(r.id)
        touched.add(r.albumId)
      }
    })()
    flush()
  }

  return { scanFolder, removeUnder, indexCue, refreshAlbum, indexFile: async (p) => { await indexFile(p); flush() }, removeFile }
}
