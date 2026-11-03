import { z } from 'zod'

// 10-band graphic EQ + preamp. Gains are in dB and applied in the engine's float domain, so boosting
// never clips until the final limiter. The settings object is the single source of truth: validated in
// main, applied by the engine, echoed back in PlaybackState so every window shows the same curve.

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EQ_RANGE_DB = 12
export const EQ_Q = 1.1

const dB = z.number().min(-EQ_RANGE_DB).max(EQ_RANGE_DB)
export const EqSettingsSchema = z.object({
  enabled: z.boolean(),
  preamp: dB,
  gains: z.array(dB).length(EQ_FREQS.length),
  /** Preset name shown in the UI; 'Custom' once a band is moved by hand. */
  preset: z.string().max(40)
})
export type EqSettings = z.infer<typeof EqSettingsSchema>

export const PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Loudness: [5, 3, 0, -1, -1, 0, -1, 3, 4, 3],
  'Late night': [3, 2, 1, 0, 0, 0, 1, 2, 2, 1]
}

export const defaultEq: EqSettings = { enabled: false, preamp: 0, gains: PRESETS['Flat']!.slice(), preset: 'Flat' }

const clamp = (v: number): number => Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, Number.isFinite(v) ? v : 0))

/** Defensive parse for data read from disk: anything malformed falls back to the default, never throws. */
export function sanitizeEq(raw: unknown): EqSettings {
  const r = EqSettingsSchema.safeParse(raw)
  return r.success ? r.data : defaultEq
}

export function withPreset(name: string): EqSettings | null {
  const g = PRESETS[name]
  if (!g) return null
  return { enabled: true, preamp: autoPreamp(g), gains: g.slice(), preset: name }
}

export function setBand(eq: EqSettings, band: number, gain: number): EqSettings {
  const gains = eq.gains.slice()
  gains[band] = Math.round(clamp(gain) * 2) / 2 // half-dB steps
  return { ...eq, gains, enabled: true, preset: 'Custom', preamp: autoPreamp(gains) }
}

/** Headroom compensation: cut by the largest boost so the chain doesn't clip on loud masters. */
export function autoPreamp(gains: number[]): number {
  return -Math.max(0, ...gains)
}

type BandType = 'lowshelf' | 'peaking' | 'highshelf'
export const bandType = (i: number): BandType => (i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking')

/** RBJ biquad magnitude (dB) of one band at `f` Hz: used to draw the response curve. */
function bandResponseDb(type: BandType, f0: number, gainDb: number, f: number, fs: number): number {
  if (gainDb === 0) return 0
  const A = 10 ** (gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cos = Math.cos(w0)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (type === 'peaking') {
    const alpha = Math.sin(w0) / (2 * EQ_Q)
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A
  } else {
    const alpha = (Math.sin(w0) / 2) * Math.SQRT2 // shelf slope S = 1
    const t = 2 * Math.sqrt(A) * alpha
    if (type === 'lowshelf') {
      b0 = A * (A + 1 - (A - 1) * cos + t); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - t)
      a0 = A + 1 + (A - 1) * cos + t; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - t
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + t); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - t)
      a0 = A + 1 - (A - 1) * cos + t; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - t
    }
  }
  const w = (2 * Math.PI * f) / fs
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2)
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2)
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di))
}

/** Combined response of the whole chain (excluding preamp) at `f` Hz. */
export function eqResponseDb(gains: number[], f: number, fs = 48000): number {
  return gains.reduce((sum, g, i) => sum + bandResponseDb(bandType(i), EQ_FREQS[i]!, g, f, fs), 0)
}

export const freqLabel = (f: number): string => (f >= 1000 ? `${f / 1000}k` : String(f))
