// Decoder utilityProcess. One ffmpeg per stream; streams PCM chunks to the engine over a
// MessagePort with transferable ArrayBuffers, keeping ~10 s ahead (credit-based backpressure).
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { decodeArgs, parseInfo, titleFromPath } from './ffmpegArgs'

type Cmd =
  | { type: 'open'; id: number; path: string; startSec: number; durationSec?: number; sampleRate: number; first: boolean }
  | { type: 'credit'; id: number; frames: number }
  | { type: 'close'; id: number }

const FRAME_BYTES = 8 // 2 ch × float32
const AHEAD_SECONDS = 10
const CHUNK_FRAMES = 8192

interface Stream {
  proc: ChildProcessByStdio<null, Readable, Readable>
  sampleRate: number
  inflight: number // frames sent but not yet acknowledged by the engine
  paused: boolean
  leftover: Buffer
}

const streams = new Map<number, Stream>()
let port: Electron.MessagePortMain | null = null

const ffmpegPath = process.env['FLACON_FFMPEG'] ?? ''

function send(msg: unknown, transfer: Electron.MessagePortMain[] = []): void {
  port?.postMessage(msg, transfer)
}

function close(id: number): void {
  const s = streams.get(id)
  if (!s) return
  s.proc.kill('SIGKILL')
  streams.delete(id)
}

function open(c: Extract<Cmd, { type: 'open' }>): void {
  if (!ffmpegPath) return send({ type: 'error', id: c.id, message: 'ffmpeg binary not found' })
  const proc = spawn(ffmpegPath, decodeArgs(c.path, c.startSec, c.sampleRate, process.env['FLACON_SOXR'] === '1', c.durationSec), { stdio: ['ignore', 'pipe', 'pipe'] })
  const s: Stream = { proc, sampleRate: c.sampleRate, inflight: 0, paused: false, leftover: Buffer.alloc(0) }
  streams.set(c.id, s)

  let banner = ''
  let announced = false
  proc.stderr.on('data', (d: Buffer) => {
    if (announced) return
    banner += d.toString('utf8')
    const info = parseInfo(banner, c.path)
    if (info) {
      announced = true
      send({ type: 'info', id: c.id, info: { ...info, title: titleFromPath(c.path) } })
    }
  })

  let first = c.first
  proc.stdout.on('data', (buf: Buffer) => {
    const all = s.leftover.length ? Buffer.concat([s.leftover, buf]) : buf
    let off = 0
    while (all.length - off >= CHUNK_FRAMES * FRAME_BYTES) {
      emit(c.id, s, all.subarray(off, off + CHUNK_FRAMES * FRAME_BYTES), first, c.startSec)
      first = false
      off += CHUNK_FRAMES * FRAME_BYTES
    }
    s.leftover = Buffer.from(all.subarray(off))
    if (s.inflight >= AHEAD_SECONDS * s.sampleRate && !s.paused) {
      s.paused = true
      proc.stdout.pause()
    }
  })
  proc.stdout.on('end', () => {
    const frames = Math.floor(s.leftover.length / FRAME_BYTES)
    if (frames > 0) emit(c.id, s, s.leftover.subarray(0, frames * FRAME_BYTES), first, c.startSec)
    send({ type: 'end', id: c.id })
  })
  proc.on('error', (e) => send({ type: 'error', id: c.id, message: e.message }))
  proc.on('close', (code) => {
    if (!announced && code !== 0 && streams.has(c.id)) send({ type: 'error', id: c.id, message: 'Could not decode this file (corrupt, unsupported, or DRM-protected).' })
    if (code !== null && code !== 0 && announced) send({ type: 'error', id: c.id, message: 'Decoding stopped early; the file may be truncated.' })
  })
}

function emit(id: number, s: Stream, bytes: Buffer, first: boolean, startSec: number): void {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const frames = bytes.length / FRAME_BYTES
  s.inflight += frames
  send({ type: 'chunk', id, data: copy.buffer, frames, first, startSec }) // ArrayBuffer is structured-cloned across the port
}

process.parentPort.on('message', (e) => {
  const m = e.data as { type: string; env?: { ffmpeg: string } }
  if (m.type === 'init' && e.ports[0]) {
    port = e.ports[0]
    port.on('message', (ev) => {
      const c = ev.data as Cmd
      if (c.type === 'open') open(c)
      else if (c.type === 'close') close(c.id)
      else if (c.type === 'credit') {
        const s = streams.get(c.id)
        if (!s) return
        s.inflight = Math.max(0, s.inflight - c.frames)
        if (s.paused && s.inflight < (AHEAD_SECONDS - 2) * s.sampleRate) {
          s.paused = false
          s.proc.stdout.resume()
        }
      }
    })
    port.start()
  }
})
process.on('exit', () => [...streams.keys()].forEach(close))
