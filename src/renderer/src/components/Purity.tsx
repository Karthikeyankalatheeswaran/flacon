import { purityBadge, purityDetail, purityTier, type PurityFacts, type PurityTier } from '@shared/purity'

type Facts = Pick<PurityFacts, 'purity' | 'lossless'> & Partial<PurityFacts>

const TIER_COLOR: Record<PurityTier, string> = { pure: 'var(--ok)', good: 'var(--ink)', limited: 'var(--warn)', thin: 'var(--err)' }

export function purityColor(f: Facts): string {
  if (!f.lossless || f.purity === null) return 'var(--ink-2)'
  return TIER_COLOR[purityTier(f.purity)]
}

/** Fill line + percentage: how much of the file's frequency range actually holds music. */
export function PurityMeter({ f, width = 56, label = true }: { f: Facts; width?: number; label?: boolean }): JSX.Element {
  const color = purityColor(f)
  const text = purityBadge(f)
  const full: PurityFacts = { purity: f.purity, lossless: f.lossless, ceilingKhz: f.ceilingKhz ?? null, effBits: f.effBits ?? null, bitDepth: f.bitDepth ?? null, upscaled: !!f.upscaled }
  return (
    <span className="purity" title={purityDetail(full)} role="img" aria-label={`Purity: ${text}`}>
      <span className="purity-line" style={{ width }}>
        {f.lossless && f.purity !== null && <b style={{ width: `${f.purity}%`, background: color }} />}
        {f.lossless && f.purity === null && <b className="purity-pending" />}
        {!f.lossless && <b style={{ width: '100%', background: 'repeating-linear-gradient(90deg,var(--ink-2) 0 1px,transparent 1px 4px)' }} />}
      </span>
      {label && <span className="t-label purity-text" style={{ color }}>{f.lossless && f.purity !== null ? `${f.purity}%` : f.lossless ? '…' : 'Lossy'}</span>}
    </span>
  )
}

/** Word + number chip, e.g. "Pure 100%". */
export function PurityChip({ f }: { f: Facts }): JSX.Element {
  const full: PurityFacts = { purity: f.purity, lossless: f.lossless, ceilingKhz: f.ceilingKhz ?? null, effBits: f.effBits ?? null, bitDepth: f.bitDepth ?? null, upscaled: !!f.upscaled }
  return <span className="chip" style={{ color: purityColor(f), borderColor: 'currentColor' }} title={purityDetail(full)}>{purityBadge(f)}</span>
}
