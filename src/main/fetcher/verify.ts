import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { bandSpectrum, effectiveBitDepth, findCutoff, isFakeBitDepth, judgeSpectrum } from './analysis'
import { parseStreamInfo, type StreamInfo } from './streaminfo'

export interface VerifyResult {
  info: StreamInfo
  /** ffmpeg decoded the whole file without reporting an error. */
  decodeOk: boolean
  /** 'match'/'mismatch' against STREAMINFO's MD5; 'none' when the file carries no checksum or the depth can't be hashed. */
  md5: 'match' | 'mismatch' | 'none'
  /** Human-readable findings for the job card ("Claims 24/96 · content ends at 16 kHz"). Empty = nothing to report. */
  notes: string[]
  upscaled: boolean
  fakeBitDepth: boolean
}

function run(ffmpeg: string, args: string[], onData: (b: Buffer) => void): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    p.stdout.on('data', onData)
    p.stderr.on('data', (d: Buffer) => { if (stderr.length < 4000) stderr += d.toString() })
    p.on('error', (e) => resolve({ code: -1, stderr: String(e) }))
    p.on('close', (code) => resolve({ code, stderr }))
  })
}

async function readHead(path: string): Promise<Uint8Array> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(64)
    const { bytesRead } = await fh.read(buf, 0, 64, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

async function pcmSlice(ffmpeg: string, path: string, startSec: number, seconds: number, fmt: 'f32le' | 's32le', channels: 1 | 2): Promise<Buffer> {
  const chunks: Buffer[] = []
  await run(ffmpeg, ['-v', 'error', '-ss', String(startSec), '-i', path, '-t', String(seconds), '-map', '0:a:0', '-ac', String(channels), '-f', fmt, '-'], (b) => chunks.push(b))
  return Buffer.concat(chunks)
}

/** Integrity (decode test + STREAMINFO MD5) and quality checks (upscale cutoff, padded bit depth) for a downloaded FLAC. */
export async function verifyFlac(path: string, ffmpeg: string): Promise<VerifyResult | null> {
  const info = parseStreamInfo(await readHead(path))
  if (!info) return null
  const notes: string[] = []

  // Decode everything once; for 16/24-bit hash the PCM exactly as FLAC defines it (little-endian, native width).
  const hashable = info.bitsPerSample === 16 || info.bitsPerSample === 24
  const hash = createHash('md5')
  const out = await run(ffmpeg, ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', hashable ? (info.bitsPerSample === 16 ? 's16le' : 's24le') : 'null', '-'], (b) => { if (hashable) hash.update(b) })
  const decodeOk = out.code === 0 && out.stderr.trim() === ''
  let md5: VerifyResult['md5'] = 'none'
  if (decodeOk && hashable && info.md5) md5 = hash.digest('hex') === info.md5 ? 'match' : 'mismatch'
  if (!decodeOk) notes.push('Decoding reported errors: the file may be damaged.')
  if (md5 === 'mismatch') notes.push('Audio checksum does not match: the file is corrupt.')

  // Quality analysis on a 20 s slice from the middle (cheap, representative).
  const dur = info.totalSamples / Math.max(1, info.sampleRate)
  const start = Math.max(0, Math.floor(dur / 2 - 10))
  let upscaled = false
  let fake = false
  if (decodeOk && dur > 3) {
    const f = await pcmSlice(ffmpeg, path, start, 20, 'f32le', 1)
    const mono = new Float32Array(f.buffer, f.byteOffset, Math.floor(f.byteLength / 4))
    if (mono.length >= 8192) {
      const cut = findCutoff(bandSpectrum(mono, info.sampleRate))
      const v = judgeSpectrum(cut, info.sampleRate)
      if (v.kind === 'likely-lossy-source') {
        upscaled = true
        notes.push(`Claims ${info.bitsPerSample}/${info.sampleRate / 1000}: content ends near ${(v.cutoffHz / 1000).toFixed(1)} kHz, like a ${v.resembles} kHz lossy source.`)
      }
    }
    if (info.bitsPerSample > 16) {
      const s = await pcmSlice(ffmpeg, path, start, 10, 's32le', 1)
      const eff = effectiveBitDepth(new Int32Array(s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength - (s.byteLength % 4))))
      if (isFakeBitDepth(info.bitsPerSample, eff)) {
        fake = true
        notes.push(`Labelled ${info.bitsPerSample}-bit but only ${eff}-bit data is present.`)
      }
    }
  }
  return { info, decodeOk, md5, notes, upscaled, fakeBitDepth: fake }
}
