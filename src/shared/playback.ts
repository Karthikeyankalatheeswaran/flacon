import { z } from 'zod'
import { defaultEq, EqSettingsSchema, type EqSettings } from './eq'
import type { LibrarySong } from './library'
import type { RepeatMode } from './queue'
import type { ReplayGainMode } from './replayGain'

export const AUDIO_EXTENSIONS = ['flac', 'alac', 'm4a', 'wav', 'aiff', 'aif', 'ape', 'wv', 'ogg', 'oga', 'opus', 'mp3', 'aac', 'wma', 'dsf', 'dff'] as const

export function isAudioPath(p: string): boolean {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

export const CueSliceSchema = z.object({ startSec: z.number().min(0).max(36 * 3600), endSec: z.number().min(0).max(36 * 3600) })
export const TrackRefSchema = z.object({
  path: z.string().min(1).max(4096).refine(isAudioPath, 'unsupported audio file'),
  /** Display title for slices of a file (CUE tracks). */
  title: z.string().max(512).optional(),
  /** Play only [startSec, endSec) of the file (CUE tracks). `path` stays the virtual path; `file` is what is decoded. */
  cue: CueSliceSchema.optional(),
  file: z.string().min(1).max(4096).refine(isAudioPath, 'unsupported audio file').optional(),
  /** ReplayGain track gain (dB) and linear peak, filled in by main from the library. */
  gainDb: z.number().min(-60).max(60).nullable().optional(),
  peak: z.number().min(0).max(100).nullable().optional()
})
export type TrackRef = z.infer<typeof TrackRefSchema>

/** Commands UI → main → engine. Validated in main before forwarding. */
export const PlaybackCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('load'), tracks: z.array(TrackRefSchema).min(1).max(5000), index: z.number().int().min(0).default(0), paused: z.boolean().optional(), startSec: z.number().min(0).max(36 * 3600).optional() }),
  z.object({ type: z.literal('play') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('toggle') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('prev') }),
  z.object({ type: z.literal('seek'), seconds: z.number().min(0).max(36 * 3600) }),
  z.object({ type: z.literal('volume'), slider: z.number().min(0).max(1) }),
  z.object({ type: z.literal('output'), deviceId: z.string().max(512), /** Pick by name (what Settings stores): ids change between launches. */ label: z.string().max(256).optional() }),
  z.object({ type: z.literal('eq'), eq: EqSettingsSchema }),
  z.object({ type: z.literal('enqueue'), tracks: z.array(TrackRefSchema).min(1).max(5000), mode: z.enum(['next', 'last']) }),
  z.object({ type: z.literal('remove'), index: z.number().int().min(0).max(1_000_000) }),
  z.object({ type: z.literal('move'), from: z.number().int().min(0).max(1_000_000), to: z.number().int().min(0).max(1_000_000) }),
  z.object({ type: z.literal('jump'), index: z.number().int().min(0).max(1_000_000) }),
  z.object({ type: z.literal('clear') }),
  /** Bring back an earlier queue (slot = index into PlaybackState.queueHistory). */
  z.object({ type: z.literal('queueRestore'), slot: z.number().int().min(0).max(50) }),
  z.object({ type: z.literal('shuffle'), on: z.boolean() }),
  z.object({ type: z.literal('repeat'), mode: z.enum(['off', 'all', 'one']) }),
  z.object({ type: z.literal('replayGain'), mode: z.enum(['off', 'track']) }),
  z.object({ type: z.literal('crossfade'), seconds: z.number().min(0).max(10) }),
  /** Start/stop streaming spectrum bars to the UI (only while a visualizer is on screen). */
  z.object({ type: z.literal('viz'), on: z.boolean() })
])
export type PlaybackCommand = z.infer<typeof PlaybackCommandSchema>

export interface TrackInfo {
  path: string
  title: string
  durationSec: number
  sampleRate: number
  channels: number
  bitDepth: number | null
  codec: string
}

/** Everything the UI windows, tray and island need; engine owns it, main rebroadcasts it. */
export interface PlaybackState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  track: TrackInfo | null
  positionSec: number
  volume: number
  outputRate: number
  outputLatencySec: number
  /** Sound outputs the OS offers right now, and the one in use ('' = system default). */
  outputDevices: Array<{ id: string; label: string }>
  outputId: string
  queueIndex: number
  queueLength: number
  error: string | null
  toast: string | null
  eq: EqSettings
  shuffle: boolean
  repeat: RepeatMode
  replayGain: ReplayGainMode
  /** Bumps whenever the queue contents change; the UI refetches the queue when it moves. */
  queueRev: number
  /** Earlier queues that can be brought back, oldest first ("undo clear", "undo remove", the queue a new album replaced). */
  queueHistory: Array<{ why: string; count: number; at: number }>
  /** Library facts for the playing track (art, purity…); attached by main, absent for files outside the library. */
  meta?: LibrarySong | null
}

export const initialPlayback: PlaybackState = {
  status: 'idle', track: null, positionSec: 0, volume: 0.8, outputRate: 0, outputLatencySec: 0, outputDevices: [], outputId: '',
  queueIndex: 0, queueLength: 0, error: null, toast: null, eq: defaultEq, shuffle: false, repeat: 'off', replayGain: 'off', queueRev: 0, queueHistory: [], meta: null
}

/** Perceptual volume: slider 0..1 → −60 dB..0 dB, applied in the float domain. 0 is true silence. */
export function gainFromSlider(slider: number): number {
  if (slider <= 0) return 0
  return 10 ** (((slider - 1) * 60) / 20)
}

export function sliderLabel(slider: number): string {
  return slider <= 0 ? '−∞ dB' : `${Math.round((slider - 1) * 60)} dB`
}
