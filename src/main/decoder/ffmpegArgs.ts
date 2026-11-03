import type { TrackInfo } from '@shared/playback'

/** Decode to interleaved float32 stereo at the engine's rate, starting at `startSec` (fast input seek). */
export function decodeArgs(path: string, startSec: number, sampleRate: number): string[] {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'info']
  if (startSec > 0) args.push('-ss', startSec.toFixed(3))
  // `-ac 2` downmixes 5.1+ to stereo; swr resamples to the context rate (soxr not in the dev build).
  args.push('-i', path, '-vn', '-sn', '-dn', '-map', '0:a:0', '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '2', '-ar', String(sampleRate), 'pipe:1')
  return args
}

/** Parse ffmpeg's stderr banner into track facts. Pure, so it can be tested against fixtures. */
export function parseInfo(stderr: string, path: string): Omit<TrackInfo, 'title'> | null {
  const stream = /Stream #0:\d+[^:]*: Audio: (\w+)[^,]*, (\d+) Hz, ([^,]+)(?:, (\w+))?(?: \((\d+) bit\))?/.exec(stderr)
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  if (!stream || !dur) return null
  const layout = stream[3] ?? 'stereo'
  const channels = /mono/.test(layout) ? 1 : /stereo/.test(layout) ? 2 : /(\d)\.(\d)/.test(layout) ? Number(/(\d)\.(\d)/.exec(layout)![1]) + Number(/(\d)\.(\d)/.exec(layout)![2]) : 2
  const fmt = stream[4] ?? ''
  // Only trust an explicit "(N bit)" or a PCM codec's sample format. For lossy codecs fltp/s16p is the
  // decoder's internal format, not a property of the source.
  const pcmDepth: Record<string, number> = { u8: 8, s16: 16, s32: 32, flt: 32, s64: 64, dbl: 64 }
  const bitDepth = stream[5] ? Number(stream[5]) : /^(pcm_|flac|alac|wavpack|ape)/.test(stream[1] ?? '') ? pcmDepth[fmt.replace(/p$/, '')] ?? null : null
  return {
    path,
    durationSec: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    sampleRate: Number(stream[2]),
    channels,
    bitDepth,
    codec: stream[1] ?? 'unknown'
  }
}

export function titleFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}
