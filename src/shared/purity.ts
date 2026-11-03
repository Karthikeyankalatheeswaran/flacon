// "Purity": how much of a file's frequency range actually holds music. 100 % = signal right up to
// the file's own Nyquist limit; a 24/96 file whose content stops at 22 kHz scores ~46 %. Measured from
// a real decode (see main/library/analyzer.ts), never guessed from the header.

export type PurityTier = 'pure' | 'good' | 'limited' | 'thin'

/** Share of the band that holds signal, 0–100. Within 4 % of Nyquist counts as full. */
export function purityPercent(cutoffHz: number, nyquistHz: number): number {
  if (!(nyquistHz > 0) || !(cutoffHz > 0)) return 0
  const r = cutoffHz / nyquistHz
  return r >= 0.96 ? 100 : Math.max(1, Math.round(r * 100))
}

export function purityTier(p: number): PurityTier {
  return p >= 95 ? 'pure' : p >= 75 ? 'good' : p >= 50 ? 'limited' : 'thin'
}

export const TIER_LABEL: Record<PurityTier, string> = { pure: 'Pure', good: 'Clean', limited: 'Limited', thin: 'Thin' }

export interface PurityFacts {
  purity: number | null
  ceilingKhz: number | null
  lossless: boolean
  effBits: number | null
  bitDepth: number | null
  upscaled: boolean
}

/** Short badge text: "Pure 100%", "Thin 46%", "Lossy", "Measuring…". */
export function purityBadge(f: Pick<PurityFacts, 'purity' | 'lossless'>): string {
  if (!f.lossless) return 'Lossy'
  if (f.purity === null) return 'Measuring…'
  return `${TIER_LABEL[purityTier(f.purity)]} ${f.purity}%`
}

/** One honest sentence for tooltips and the now-playing detail. */
export function purityDetail(f: PurityFacts): string {
  if (!f.lossless) return 'Lossy format: music is already discarded, so purity is not measured.'
  if (f.purity === null) return 'Purity is measured in the background; it appears shortly.'
  const parts = [f.purity >= 96 ? 'Signal reaches the top of the band.' : `Signal stops near ${f.ceilingKhz ?? '?'} kHz.`]
  if (f.bitDepth && f.bitDepth > 16 && f.effBits !== null && f.effBits <= 16) parts.push(`Claims ${f.bitDepth}-bit but only uses 16.`)
  else if (f.effBits !== null && f.bitDepth) parts.push(`Uses ${Math.min(f.effBits, f.bitDepth)} real bits.`)
  if (f.upscaled) parts.push('Looks upscaled from a lower-quality source.')
  return parts.join(' ')
}

/** Mean of the measured values; null when nothing has been measured yet. */
export function meanPurity(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => x !== null)
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
}
