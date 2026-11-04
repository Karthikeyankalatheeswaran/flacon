// Background purity analysis: decodes ~20 s from the middle of each lossless track with ffmpeg,
// finds where the signal stops (spectrum) and how many bits the samples really use, and stores it.
// One file at a time, low priority, resumable (rows stay `analyzed = 0` until measured).
import { inputArgs } from '../ffmpegSafe'
import { spawn } from 'node:child_process'
import { bandSpectrum, effectiveBitDepth, findCutoff, isFakeBitDepth, judgeSpectrum } from '../fetcher/analysis'
import { purityPercent } from '@shared/purity'
import type { Db } from './db'

const SECONDS = 20

export interface Measurement {
  purity: number
  ceilingHz: number
  effBits: number | null
  upscaled: boolean
}

/**
 * Decode a window as left-aligned 32-bit PCM and keep the left channel. The bundled LGPL ffmpeg has no `pan` filter,
 * and a downmix would fill the low bits (hiding padded bit depth), so channels are split here. Resolves null when ffmpeg can't read it.
 */
function decode(ffmpeg: string, file: string, startSec: number, rate: number, channels: number): Promise<Int32Array | null> {
  const ch = Math.max(1, Math.min(8, channels || 2))
  const maxBytes = rate * SECONDS * 4 * ch + 4096
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-nostdin', '-ss', startSec.toFixed(2), '-t', String(SECONDS), ...inputArgs(file), '-vn', '-ar', String(rate), '-f', 's32le', '-']
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    let n = 0
    p.stdout.on('data', (c: Buffer) => {
      n += c.length
      if (n > maxBytes) p.kill()
      else chunks.push(c)
    })
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const buf = Buffer.concat(chunks)
      const frames = Math.floor(buf.length / (4 * ch))
      if (frames < 8192) return resolve(null)
      const left = new Int32Array(frames)
      for (let i = 0; i < frames; i++) left[i] = buf.readInt32LE(i * ch * 4)
      resolve(left)
    })
  })
}

/** Pure part of the measurement, exposed for tests. */
export function measure(pcm: Int32Array, sampleRate: number, bitDepth: number | null): Measurement | null {
  const mono = new Float32Array(pcm.length)
  let peak = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]! / 2147483648
    mono[i] = v
    if (Math.abs(v) > peak) peak = Math.abs(v)
  }
  if (peak < 1e-4) return null // silence: nothing to measure
  const spec = bandSpectrum(mono, sampleRate)
  const cut = findCutoff(spec)
  const eff = effectiveBitDepth(pcm)
  const verdict = judgeSpectrum(cut, sampleRate)
  const purity = cut.fullBand ? 100 : purityPercent(cut.cutoffHz, spec.nyquist)
  const upscaled = verdict.kind === 'likely-lossy-source' || (spec.nyquist > 24000 && cut.cutoffHz < 23000) || isFakeBitDepth(bitDepth ?? 0, eff)
  return { purity, ceilingHz: cut.cutoffHz, effBits: eff, upscaled }
}

export interface Analyzer {
  /** Start (or nudge) the background loop. */
  kick(): void
  progress(): { done: number; total: number }
  stop(): void
}

export function createAnalyzer(db: Db, ffmpeg: string, onBatch: (albumIds: number[]) => void): Analyzer {
  const next = db.prepare(`select id, path, duration, sample_rate as rate, bit_depth as bits, channels, album_id as albumId from tracks
    where analyzed = 0 and lossless = 1 and missing = 0 and cue_start is null order by id limit 1`)
  const markSkip = db.prepare('update tracks set analyzed = 1 where id = ?')
  const save = db.prepare('update tracks set analyzed = 1, purity = @purity, ceiling_hz = @ceilingHz, eff_bits = @effBits, upscaled = @upscaled where id = @id')
  const remaining = db.prepare('select count(*) n from tracks where analyzed = 0 and lossless = 1 and missing = 0 and cue_start is null')
  // Lossy files and CUE slices are never measured: mark them done so they don't count as pending.
  db.prepare('update tracks set analyzed = 1 where analyzed = 0 and (lossless = 0 or cue_start is not null)').run()
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
        const row = next.get() as { id: number; path: string; duration: number; rate: number; bits: number | null; channels: number; albumId: number } | undefined
        if (!row) break
        const start = Math.max(0, row.duration / 2 - SECONDS / 2)
        const pcm = await decode(ffmpeg, row.path, start, row.rate || 44100, row.channels)
        const m = pcm ? measure(pcm, row.rate || 44100, row.bits) : null
        if (m) save.run({ id: row.id, purity: m.purity, ceilingHz: Math.round(m.ceilingHz), effBits: m.effBits, upscaled: m.upscaled ? 1 : 0 })
        else markSkip.run(row.id)
        touched.add(row.albumId)
        done++
        if (done % 10 === 0 || touched.size > 0 && done === total) { onBatch([...touched]); touched = new Set() }
        await new Promise((r) => setTimeout(r, 15)) // yield: the worker keeps answering queries
      }
    } finally {
      if (touched.size) onBatch([...touched])
      touched = new Set()
      running = false
    }
  }

  return { kick: () => void loop(), progress: () => ({ done, total: Math.max(total, done) }), stop: () => { stopped = true } }
}
