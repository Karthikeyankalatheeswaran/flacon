import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl from 'yauzl'
import { FETCH_LIMITS, checkZipEntry, uniquePath } from '@shared/fetch'

export interface ZipResult {
  files: string[]
  skipped: Array<{ name: string; reason: string }>
}

/**
 * Extract only audio / artwork / cue / log files from `zipPath` into `destDir`.
 * Guards: zip-slip (checked twice: by name and by resolved path), entry count, total and per-entry size
 * (measured on the bytes actually written, not the header), compression ratio, case-insensitive collisions.
 */
export function extractZip(zipPath: string, destDir: string, signal?: AbortSignal): Promise<ZipResult> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, strictFileNames: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Not a readable ZIP file.'))
      const root = resolve(destDir)
      const files: string[] = []
      const skipped: ZipResult['skipped'] = []
      const taken = new Set<string>()
      let total = 0
      let seen = 0
      const fail = (e: Error): void => {
        zip.close()
        reject(e)
      }
      signal?.addEventListener('abort', () => fail(new Error('Canceled')), { once: true })

      zip.on('error', fail)
      zip.on('end', () => resolvePromise({ files, skipped }))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (++seen > FETCH_LIMITS.maxZipEntries) return fail(new Error('This ZIP has too many files.'))
        const d = checkZipEntry({ name: entry.fileName, size: entry.uncompressedSize, compressed: entry.compressedSize })
        if (!d.keep) {
          if (d.reason !== 'ignored') skipped.push({ name: entry.fileName, reason: d.reason })
          return zip.readEntry()
        }
        total += entry.uncompressedSize
        if (total > FETCH_LIMITS.maxZipBytes) return fail(new Error('This ZIP expands to more than the allowed size.'))
        const rel = uniquePath(d.rel, taken)
        const target = resolve(join(root, rel))
        if (!target.startsWith(root + sep)) {
          skipped.push({ name: entry.fileName, reason: 'unsafe' })
          return zip.readEntry()
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return fail(e ?? new Error('Unreadable ZIP entry.'))
          let written = 0
          const guard = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              written += chunk.length
              // A lying header can't smuggle more data than we agreed to.
              cb(written > Math.max(entry.uncompressedSize, 1) * 1.01 + 1024 ? new Error('ZIP entry is larger than declared.') : null, chunk)
            }
          })
          fs.mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, guard, createWriteStream(target, { flags: 'wx' })))
            .then(() => {
              files.push(target)
              zip.readEntry()
            })
            .catch((pe: Error) => fs.rm(target, { force: true }).finally(() => fail(pe)))
        })
      })
      zip.readEntry()
    })
  })
}
