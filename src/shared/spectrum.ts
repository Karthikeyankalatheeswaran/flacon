/** Visualizer maths: collapse an FFT into a handful of log-spaced bars. Pure, so it is tested. */

export const VIZ_BARS = 48
export const VIZ_MIN_HZ = 40
export const VIZ_MAX_HZ = 16000

/** FFT bin range [lo, hi) of each bar, log-spaced between VIZ_MIN_HZ and VIZ_MAX_HZ; every bar has at least one bin. */
export function barRanges(sampleRate: number, fftSize: number, bars = VIZ_BARS): Array<[number, number]> {
  const binHz = sampleRate / fftSize
  const maxBin = fftSize / 2
  const max = Math.min(VIZ_MAX_HZ, sampleRate / 2)
  const out: Array<[number, number]> = []
  let prev = Math.max(1, Math.floor(VIZ_MIN_HZ / binHz))
  for (let i = 1; i <= bars; i++) {
    const hz = VIZ_MIN_HZ * (max / VIZ_MIN_HZ) ** (i / bars)
    const hi = Math.min(maxBin, Math.max(prev + 1, Math.round(hz / binHz)))
    out.push([prev, hi])
    prev = hi
  }
  return out
}

/** Peak byte (0–255) inside each range. Max rather than mean so a single tone is still visible in a wide high bar. */
export function foldBars(freqBytes: Uint8Array, ranges: Array<[number, number]>): Uint8Array {
  const out = new Uint8Array(ranges.length)
  ranges.forEach(([lo, hi], i) => {
    let m = 0
    for (let b = lo; b < hi && b < freqBytes.length; b++) if (freqBytes[b]! > m) m = freqBytes[b]!
    out[i] = m
  })
  return out
}

/** Smooth bars for drawing: rise instantly, fall at `fall` per frame. */
export function smooth(prev: Float32Array, next: Uint8Array, fall = 0.12): Float32Array {
  const out = new Float32Array(next.length)
  for (let i = 0; i < next.length; i++) {
    const v = next[i]! / 255
    out[i] = Math.max(v, (prev[i] ?? 0) - fall)
  }
  return out
}
