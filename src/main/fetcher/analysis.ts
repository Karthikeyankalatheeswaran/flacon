// Pure signal analysis used by the fetcher's post-processing: no I/O, so it is unit-tested on synthetic signals.

/** In-place radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr; im[b] = im[a]! - ti
        re[a]! += tr; im[a]! += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

const WIN = 4096

export interface Spectrum {
  /** Average level in dB per band of `bandHz` width, index 0 = 0 Hz. */
  bands: number[]
  bandHz: number
  nyquist: number
}

/** Averaged power spectrum (Hann, up to 24 windows) folded into 250 Hz bands. */
export function bandSpectrum(mono: Float32Array, sampleRate: number): Spectrum {
  const hann = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)))
  const hop = Math.max(WIN, Math.floor((mono.length - WIN) / 24))
  const power = new Float64Array(WIN / 2)
  let windows = 0
  for (let start = 0; start + WIN <= mono.length && windows < 24; start += hop) {
    const re = new Float64Array(WIN), im = new Float64Array(WIN)
    for (let i = 0; i < WIN; i++) re[i] = mono[start + i]! * hann[i]!
    fft(re, im)
    for (let k = 0; k < WIN / 2; k++) power[k]! += re[k]! * re[k]! + im[k]! * im[k]!
    windows++
  }
  const binHz = sampleRate / WIN
  const bandHz = 250
  const per = Math.max(1, Math.round(bandHz / binHz))
  const bands: number[] = []
  for (let k = 0; k + per <= WIN / 2; k += per) {
    let s = 0
    for (let j = 0; j < per; j++) s += power[k + j]!
    bands.push(10 * Math.log10(s / per / Math.max(1, windows) + 1e-20))
  }
  return { bands, bandHz: per * binHz, nyquist: sampleRate / 2 }
}

export interface Cutoff {
  /** Highest frequency with real content. Equals Nyquist when the band is full. */
  cutoffHz: number
  fullBand: boolean
}

/** Find where content stops. Full-band material keeps energy well above the noise floor right up to Nyquist. */
export function findCutoff(s: Spectrum): Cutoff {
  const { bands, bandHz, nyquist } = s
  const ref = Math.max(...bands.slice(Math.floor(1000 / bandHz), Math.floor(5000 / bandHz)))
  const topFloor = Math.min(...bands.slice(-3))
  // Band is "full" if the very top still sits within 55 dB of the midrange, or well above the floor of its own.
  if (bands.slice(-3).every((b) => b > ref - 55)) return { cutoffHz: nyquist, fullBand: true }
  const threshold = topFloor + 12
  let last = 0
  for (let i = 0; i < bands.length; i++) if (bands[i]! > threshold && bands[i]! > ref - 90) last = i
  return { cutoffHz: Math.round((last + 1) * bandHz), fullBand: false }
}

export type SpectralVerdict = { kind: 'ok' } | { kind: 'likely-lossy-source'; cutoffHz: number; resembles: 16 | 19 | 20 }

/** Lossy encoders lowpass at characteristic points (≈16, 19, 20 kHz). A lossless file stopping there was probably decoded from one. */
export function judgeSpectrum(c: Cutoff, sampleRate: number): SpectralVerdict {
  if (sampleRate < 44100 || c.fullBand) return { kind: 'ok' }
  const khz = c.cutoffHz / 1000
  const hit = ([16, 19, 20] as const).find((t) => Math.abs(khz - t) <= 0.6)
  return hit && c.cutoffHz < sampleRate / 2 * 0.95 ? { kind: 'likely-lossy-source', cutoffHz: c.cutoffHz, resembles: hit } : { kind: 'ok' }
}

/**
 * Effective bit depth of left-aligned 32-bit PCM: the width left after the always-zero low bits are dropped.
 * Ignores silence. Returns null when there's too little signal to say.
 */
export function effectiveBitDepth(samples: Int32Array): number | null {
  let nonzero = 0
  let padded16 = 0
  let padded8 = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!
    if (v === 0) continue
    nonzero++
    if ((v & 0xffff) === 0) padded16++
    if ((v & 0xff) === 0) padded8++
  }
  if (nonzero < 1000) return null
  if (padded16 / nonzero > 0.999) return 16
  if (padded8 / nonzero > 0.999) return 24
  return 32
}

/** A file claiming more than 16 bits whose samples only ever use 16 is "fake" hi-res. */
export const isFakeBitDepth = (claimed: number, effective: number | null): boolean => claimed > 16 && effective !== null && effective <= 16
