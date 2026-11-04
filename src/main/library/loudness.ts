// Background loudness + dynamic-range measurement: decodes each whole track with ffmpeg as float PCM and streams it
// through the BS.1770 / DR meter in shared/loudness.ts. One file at a time, at low priority, resumable (`loud_done = 0` until measured).
import { inputArgs } from '../ffmpegSafe'
import { spawn } from 'node:child_process'
import { setPriority } from 'node:os'
import { LoudnessMeter, type LoudnessResult } from '@shared/loudness'
import type { Db } from './db'

const MAX_SECONDS = 3 * 3600 // a day-long field recording is not worth minutes of decoding

/** Stream a file through the meter. Resolves null when ffmpeg can't read it or the file is silent/too short. */
export function measureFile(ffmpeg: string, file: string, rate: number, channels: number): Promise<LoudnessResult | null> {
  const ch = channels === 1 ? 1 : 2
  const fs = rate > 0 ? rate : 44100
  const meter = new LoudnessMeter(fs, ch)
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-nostdin', '-t', String(MAX_SECONDS), ...inputArgs(file), '-vn', '-ac', String(ch), '-ar', String(fs), '-f', 'f32le', '-']
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    try { if (p.pid) setPriority(p.pid, 10) } catch { /* not permitted: run at normal priority */ }
    let tail: Buffer = Buffer.alloc(0)
    let frames = 0
    p.stdout.on('data', (c: Buffer) => {
      const buf = tail.length ? Buffer.concat([tail, c]) : c
      const usable = buf.length - (buf.length % 4)
      tail = buf.subarray(usable)
      // Copy to an aligned Float32Array (a Buffer slice may sit at an odd byte offset).
      const f = new Float32Array(usable / 4)
      for (let i = 0; i < f.length; i++) f[i] = buf.readFloatLE(i * 4)
      frames += f.length / ch
      meter.push(f)
    })
    p.on('error', () => resolve(null))
    p.on('close', () => {
      if (frames < fs) return resolve(null) // under a second: nothing meaningful
      const r = meter.result()
      resolve(r.lufs === null && r.dr === null ? null : r)
    })
  })
}

export interface LoudnessAnalyzer {
  kick(): void
  progress(): { done: number; total: number }
  stop(): void
}

export function createLoudnessAnalyzer(db: Db, ffmpeg: string, onBatch: (albumIds: number[]) => void, busy: () => boolean): LoudnessAnalyzer {
  const pendingSql = 'from tracks where loud_done = 0 and missing = 0 and cue_start is null'
  const next = db.prepare(`select id, path, sample_rate as rate, channels, album_id as albumId ${pendingSql} order by lossless desc, id limit 1`)
  const remaining = db.prepare(`select count(*) n ${pendingSql}`)
  const save = db.prepare('update tracks set loud_done = 1, lufs = @lufs, dr = @dr where id = @id')
  const skip = db.prepare('update tracks set loud_done = 1 where id = ?')
  db.prepare('update tracks set loud_done = 1 where loud_done = 0 and cue_start is not null').run() // slices share their file's measure; never measured alone
  let running = false
  let stopped = false
  let done = 0
  let total = 0
  let touched = new Set<number>()

  async function loop(): Promise<void> {
    if (running || stopped || !ffmpeg) return
    running = true
    total = (remaining.get() as { n: number }).n
    done = 0
    try {
      for (;;) {
        if (stopped) break
        if (busy()) { await new Promise((r) => setTimeout(r, 2000)); continue } // purity analysis goes first
        const row = next.get() as { id: number; path: string; rate: number; channels: number; albumId: number } | undefined
        if (!row) break
        const m = await measureFile(ffmpeg, row.path, row.rate, row.channels)
        if (m) save.run({ id: row.id, lufs: m.lufs === null ? null : Math.round(m.lufs * 10) / 10, dr: m.dr === null ? null : Math.round(m.dr * 10) / 10 })
        else skip.run(row.id)
        touched.add(row.albumId)
        done++
        if (done % 10 === 0) { onBatch([...touched]); touched = new Set() }
        await new Promise((r) => setTimeout(r, 25))
      }
    } finally {
      if (touched.size) onBatch([...touched])
      touched = new Set()
      running = false
    }
  }

  return { kick: () => void loop(), progress: () => ({ done, total: Math.max(total, done) }), stop: () => { stopped = true } }
}
