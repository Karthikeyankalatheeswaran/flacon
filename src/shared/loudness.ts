// Loudness and dynamic range, measured in plain TypeScript so no ffmpeg filter is needed (the bundled LGPL build has no ebur128).
//  - Integrated loudness: ITU-R BS.1770-4 K-weighting, 400 ms blocks every 100 ms, absolute (−70 LUFS) and relative (−10 LU) gates.
//  - Dynamic range: the "DR" method. Per channel, 3 s blocks: DR = peak of the 2nd-loudest block ÷ RMS of the loudest 20% of blocks.
// Both are fed interleaved float samples in any chunk size, so a decoder can stream into them.

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** BS.1770-4 stage 1 (high shelf, +4 dB) for any sample rate. */
export function shelfCoeffs(fs: number): Biquad {
  const f0 = 1681.974450955533, g = 3.999843853973347, q = 0.7071752369554196
  const k = Math.tan((Math.PI * f0) / fs)
  const vh = 10 ** (g / 20)
  const vb = vh ** 0.4996667741545416
  const a0 = 1 + k / q + k * k
  return { b0: (vh + (vb * k) / q + k * k) / a0, b1: (2 * (k * k - vh)) / a0, b2: (vh - (vb * k) / q + k * k) / a0, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 }
}

/** BS.1770-4 stage 2 (revised low-frequency B-weighting high-pass). */
export function highpassCoeffs(fs: number): Biquad {
  const f0 = 38.13547087602444, q = 0.5003270373238773
  const k = Math.tan((Math.PI * f0) / fs)
  const a0 = 1 + k / q + k * k
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 }
}

class Filter {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0
  constructor(private readonly c: Biquad) {}
  step(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.c
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
}

const OFFSET = -0.691
const lufsOf = (energy: number): number => OFFSET + 10 * Math.log10(energy)
const energyOf = (lufs: number): number => 10 ** ((lufs - OFFSET) / 10)

export interface LoudnessResult {
  /** Integrated loudness, LUFS. Null when the signal is silent. */
  lufs: number | null
  /** Highest sample, dBFS (not oversampled, so a "sample peak"). */
  peakDb: number | null
  /** Dynamic range (DR), dB. Null for silence. */
  dr: number | null
}

export class LoudnessMeter {
  private readonly shelf: Filter[]
  private readonly hp: Filter[]
  private readonly step: number // samples per 100 ms
  private readonly drBlock: number // samples per 3 s
  private readonly buckets: number[][] = [] // per 100 ms: mean-square of each channel
  private cur: number[]
  private curN = 0
  private blocks: number[] = [] // energy (sum over channels) of every 400 ms block
  private peak = 0
  // dynamic range: per channel, per 3 s block
  private drSum: number[]; private drPeak: number[]; private drN = 0
  private drRms: number[][]; private drPk: number[][]
  private carry: number[] = []

  constructor(readonly sampleRate: number, readonly channels = 2) {
    const sh = shelfCoeffs(sampleRate), hp = highpassCoeffs(sampleRate)
    this.shelf = Array.from({ length: channels }, () => new Filter(sh))
    this.hp = Array.from({ length: channels }, () => new Filter(hp))
    this.step = Math.max(1, Math.round(sampleRate * 0.1))
    this.drBlock = Math.max(1, Math.round(sampleRate * 3))
    this.cur = new Array(channels).fill(0)
    this.drSum = new Array(channels).fill(0)
    this.drPeak = new Array(channels).fill(0)
    this.drRms = Array.from({ length: channels }, () => [])
    this.drPk = Array.from({ length: channels }, () => [])
  }

  /** Feed interleaved samples (−1…1). Partial frames are carried to the next call. */
  push(samples: Float32Array): void {
    const ch = this.channels
    let i = 0
    if (this.carry.length) {
      while (this.carry.length < ch && i < samples.length) this.carry.push(samples[i++]!)
      if (this.carry.length < ch) return
      this.frame(this.carry)
      this.carry = []
    }
    const frame = new Array<number>(ch)
    for (; i + ch <= samples.length; i += ch) {
      for (let c = 0; c < ch; c++) frame[c] = samples[i + c]!
      this.frame(frame)
    }
    for (; i < samples.length; i++) this.carry.push(samples[i]!)
  }

  private frame(f: number[]): void {
    for (let c = 0; c < this.channels; c++) {
      const x = f[c]!
      const ax = Math.abs(x)
      if (ax > this.peak) this.peak = ax
      const w = this.hp[c]!.step(this.shelf[c]!.step(x))
      this.cur[c]! += w * w
      this.drSum[c]! += x * x
      if (ax > this.drPeak[c]!) this.drPeak[c] = ax
    }
    if (++this.curN === this.step) {
      this.buckets.push(this.cur.map((s) => s / this.step))
      this.cur = new Array(this.channels).fill(0)
      this.curN = 0
      if (this.buckets.length >= 4) {
        const last = this.buckets.slice(-4)
        let e = 0
        for (let c = 0; c < this.channels; c++) e += (last[0]![c]! + last[1]![c]! + last[2]![c]! + last[3]![c]!) / 4
        this.blocks.push(e)
        if (this.buckets.length > 4) this.buckets.shift()
      }
    }
    if (++this.drN === this.drBlock) this.closeDrBlock(this.drBlock)
  }

  private closeDrBlock(n: number): void {
    for (let c = 0; c < this.channels; c++) {
      this.drRms[c]!.push(Math.sqrt((2 * this.drSum[c]!) / n)) // ×√2 so a full-scale sine reads 0 dB
      this.drPk[c]!.push(this.drPeak[c]!)
      this.drSum[c] = 0
      this.drPeak[c] = 0
    }
    this.drN = 0
  }

  result(): LoudnessResult {
    const peakDb = this.peak > 0 ? 20 * Math.log10(this.peak) : null
    return { lufs: this.integrated(), peakDb, dr: this.dynamicRange() }
  }

  private integrated(): number | null {
    const absGate = energyOf(-70)
    const above = this.blocks.filter((e) => e > absGate)
    if (!above.length) return null
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    const relGate = energyOf(lufsOf(mean(above)) - 10)
    const kept = above.filter((e) => e > relGate)
    return kept.length ? lufsOf(mean(kept)) : null
  }

  private dynamicRange(): number | null {
    // A track shorter than one block is judged on what there is.
    const tail = this.drN
    const rms = this.drRms.map((r) => r.slice()), pk = this.drPk.map((p) => p.slice())
    if (!rms[0]!.length && tail > 0) {
      for (let c = 0; c < this.channels; c++) {
        rms[c]!.push(Math.sqrt((2 * this.drSum[c]!) / tail))
        pk[c]!.push(this.drPeak[c]!)
      }
    }
    const per: number[] = []
    for (let c = 0; c < this.channels; c++) {
      const r = rms[c]!, p = pk[c]!
      if (!r.length) continue
      const sortedRms = [...r].sort((a, b) => b - a)
      const top = sortedRms.slice(0, Math.max(1, Math.ceil(r.length * 0.2)))
      const rmsTop = Math.sqrt(top.reduce((a, b) => a + b * b, 0) / top.length)
      const sortedPk = [...p].sort((a, b) => b - a)
      const pk2 = sortedPk[1] ?? sortedPk[0]!
      if (rmsTop > 1e-6 && pk2 > 0) per.push(20 * Math.log10(pk2 / rmsTop))
    }
    return per.length ? Math.max(0, per.reduce((a, b) => a + b, 0) / per.length) : null
  }
}
