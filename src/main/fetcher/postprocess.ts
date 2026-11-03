import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { parseFile } from 'music-metadata'
import { DEFAULT_TEMPLATE, renderTemplate, uniquePath, type FetchItem } from '@shared/fetch'
import { verifyFlac } from './verify'

const exec = promisify(execFile)

export class PostError extends Error {}

export interface ImportDeps {
  ffmpeg: string
  /** Managed library root; files are renamed by template beneath it. */
  libraryRoot: string
  template?: string
}

export interface Imported {
  dest: string
  notes: string[]
  /** True when an identical file was already in the library, so nothing new was written. */
  duplicate: boolean
}

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

/** Rewrite tags without touching the audio stream (-c copy keeps the FLAC MD5 valid). Atomic: temp file, then rename. */
async function writeTags(ffmpeg: string, file: string, tags: Record<string, string>): Promise<void> {
  const tmp = file + '.tagging.flac'
  const args = ['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', ...Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), tmp]
  try {
    await exec(ffmpeg, args)
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw new PostError(`Couldn’t write tags: ${(e as Error).message.split('\n')[0]}`)
  }
}

/**
 * Verify, tag, rename-by-template and move one downloaded audio file into the library.
 * Corrupt files are rejected (PostError); upscaled / fake-bit-depth files are kept but flagged in `notes`.
 */
export async function importFile(staged: string, item: FetchItem, deps: ImportDeps): Promise<Imported> {
  const notes: string[] = []
  const isFlac = /\.flac$/i.test(staged)
  if (isFlac) {
    const v = await verifyFlac(staged, deps.ffmpeg)
    if (!v) throw new PostError('This isn’t a valid FLAC file.')
    if (!v.decodeOk || v.md5 === 'mismatch') throw new PostError(v.notes[0] ?? 'The file is damaged.')
    notes.push(...v.notes)
    if (v.md5 === 'none') notes.push('No checksum in file: integrity checked by decoding only.')
  }

  let common: Awaited<ReturnType<typeof parseFile>>['common'] | undefined
  try {
    common = (await parseFile(staged, { duration: false, skipPostHeaders: true })).common
  } catch {
    throw new PostError('Couldn’t read this file’s tags.')
  }

  // Fill gaps from the source's metadata and record the licence in the file itself (COPYRIGHT/LICENSE).
  const fill: Record<string, string> = {}
  if (!common.title && item.title) fill['title'] = item.title
  if (!common.artist && item.artist) fill['artist'] = item.artist
  if (!common.album && item.album) fill['album'] = item.album
  if (item.license) {
    fill['copyright'] = [item.license.name, item.license.attribution].filter(Boolean).join(' · ')
    if (item.license.url) fill['license'] = item.license.url
  }
  if (isFlac && Object.keys(fill).length) await writeTags(deps.ffmpeg, staged, fill)

  const ext = staged.slice(staged.lastIndexOf('.') + 1)
  const segs = renderTemplate(deps.template ?? DEFAULT_TEMPLATE, {
    albumartist: common.albumartist || common.artist || item.artist,
    album: common.album || item.album,
    year: common.year ?? null,
    disc: common.disk.no,
    track: common.track.no,
    title: common.title || item.title,
    ext
  })
  const taken = new Set<string>()
  let rel = segs.join('/')
  let dest = join(deps.libraryRoot, rel)
  if (await exists(dest)) {
    const same = (await fs.stat(dest)).size === (await fs.stat(staged)).size
    if (same) {
      await fs.rm(staged, { force: true })
      return { dest, notes: [...notes, 'Already in your library.'], duplicate: true }
    }
    // Different file, same name: keep both (collision-safe, case-insensitively).
    const siblings = await fs.readdir(dirname(dest)).catch(() => [] as string[])
    for (const s of siblings) taken.add(`${segs.slice(0, -1).join('/')}/${s}`.toLowerCase())
    rel = uniquePath(rel, taken)
    dest = join(deps.libraryRoot, rel)
  }
  await fs.mkdir(dirname(dest), { recursive: true })
  try {
    await fs.rename(staged, dest)
  } catch {
    await fs.copyFile(staged, dest) // different volume
    await fs.rm(staged, { force: true })
  }
  return { dest, notes, duplicate: false }
}

/** Cover art found beside the audio is copied next to the imported album so the library picks it up as folder art. */
export async function importCover(srcDir: string, albumDir: string): Promise<void> {
  const names = await fs.readdir(srcDir).catch(() => [] as string[])
  const cover = names.find((n) => /^(cover|folder|front|album)\.(jpe?g|png|webp)$/i.test(n))
  if (!cover) return
  const to = join(albumDir, cover.toLowerCase())
  if (!(await exists(to))) await fs.copyFile(join(srcDir, cover), to).catch(() => {})
}
