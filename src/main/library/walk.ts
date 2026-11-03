import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isAudioPath } from '@shared/playback'

export interface WalkResult {
  files: string[]
  /** .cue sheets found next to the audio. */
  cues: string[]
  /** Folders we were not allowed to read (macOS Full Disk Access / folder prompts). */
  denied: string[]
  /** False when the root itself is gone (drive offline / folder renamed or removed). */
  rootReachable: boolean
}

/**
 * Collect audio files under `root`. Directories are deduplicated by realpath, which both breaks
 * symlink loops and stops the same file being indexed under two paths.
 */
export async function walk(root: string, seenDirs = new Set<string>()): Promise<WalkResult> {
  const out: WalkResult = { files: [], cues: [], denied: [], rootReachable: true }
  const cues: string[] = []
  try {
    await fs.access(root)
  } catch {
    out.rootReachable = false
    return out
  }
  const stack = [root]
  // Same file reachable by two paths (symlinked file, or a dir reached twice): keep one, prefer the real path.
  const byIdentity = new Map<string, { path: string; viaLink: boolean }>()
  while (stack.length) {
    const dir = stack.pop()!
    let real: string
    try {
      real = await fs.realpath(dir)
    } catch {
      continue
    }
    if (seenDirs.has(real)) continue
    seenDirs.add(real)
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EPERM') out.denied.push(dir)
      continue
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue // hidden files, ._ AppleDouble, .Trashes
      const p = join(dir, ent.name)
      let isDir = ent.isDirectory()
      let isFile = ent.isFile()
      const viaLink = ent.isSymbolicLink()
      if (viaLink) {
        try {
          const st = await fs.stat(p)
          isDir = st.isDirectory()
          isFile = st.isFile()
        } catch {
          continue // dangling link
        }
      }
      if (isDir) stack.push(p)
      else if (isFile && p.toLowerCase().endsWith('.cue')) cues.push(p)
      else if (isFile && isAudioPath(p)) {
        let id = join(real, ent.name)
        if (viaLink) {
          try {
            id = await fs.realpath(p)
          } catch {
            continue
          }
        }
        const prev = byIdentity.get(id)
        if (!prev || (prev.viaLink && !viaLink)) byIdentity.set(id, { path: p, viaLink })
      }
    }
  }
  out.files = [...byIdentity.values()].map((v) => v.path).sort()
  out.cues = cues.sort()
  return out
}
