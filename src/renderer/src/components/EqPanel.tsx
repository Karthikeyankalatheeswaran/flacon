import { useEffect } from 'react'
import { EQ_FREQS, EQ_RANGE_DB, PRESETS, defaultEq, eqResponseDb, freqLabel, setBand, withPreset } from '@shared/eq'
import { useStore } from '@/store'

const signed = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} dB`

// Response curve: log-frequency x (20 Hz–20 kHz), ±12 dB y. Drawn from the same biquad maths the engine uses.
function Curve({ gains, on }: { gains: number[]; on: boolean }): JSX.Element {
  const W = 520, H = 120
  const pts: string[] = []
  for (let i = 0; i <= 120; i++) {
    const f = 20 * 1000 ** (i / 120)
    const db = on ? eqResponseDb(gains, f) : 0
    pts.push(`${((i / 120) * W).toFixed(1)},${(H / 2 - (db / EQ_RANGE_DB) * (H / 2 - 4)).toFixed(1)}`)
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Equalizer response curve" preserveAspectRatio="none">
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--rule)" />
      <polyline points={pts.join(' ')} fill="none" stroke={on ? 'var(--tint-ink)' : 'var(--ink-2)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function EqPanel(): JSX.Element {
  const eq = useStore((s) => s.pb.eq)
  const send = useStore((s) => s.send)
  const close = useStore((s) => s.setEqOpen)
  const apply = (next: typeof eq): void => send({ type: 'eq', eq: next })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <section className="eq" role="dialog" aria-label="Equalizer">
      <header className="eq-head">
        <h2 className="t-title" style={{ margin: 0 }}>Equalizer</h2>
        <label className="t-label" style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <input type="checkbox" role="switch" checked={eq.enabled} onChange={(e) => apply({ ...eq, enabled: e.target.checked })} aria-label="Equalizer on" />
          {eq.enabled ? 'On' : 'Off · bit-perfect path'}
        </label>
        <button type="button" className="ghost-btn" onClick={() => close(false)} aria-label="Close equalizer">Close</button>
      </header>
      <Curve gains={eq.gains} on={eq.enabled} />
      <div className="eq-bands" style={{ opacity: eq.enabled ? 1 : 0.5 }}>
        {EQ_FREQS.map((f, i) => (
          <label key={f} className="eq-band">
            <input type="range" min={-EQ_RANGE_DB} max={EQ_RANGE_DB} step={0.5} value={eq.gains[i]} aria-label={`${freqLabel(f)} Hz`} aria-valuetext={signed(eq.gains[i]!)}
              onChange={(e) => apply(setBand(eq, i, Number(e.target.value)))} onDoubleClick={() => apply(setBand(eq, i, 0))} />
            <span className="t-label">{freqLabel(f)}</span>
          </label>
        ))}
      </div>
      <div className="eq-foot t-label">
        <label>Preset{' '}
          <select value={PRESETS[eq.preset] ? eq.preset : ''} onChange={(e) => { const p = withPreset(e.target.value); if (p) apply(p) }} aria-label="Preset">
            {!PRESETS[eq.preset] && <option value="">Custom</option>}
            {Object.keys(PRESETS).map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <span title="Cut automatically by the largest boost so the chain doesn't clip">Preamp {signed(eq.preamp)}</span>
        <button type="button" className="ghost-btn" onClick={() => apply({ ...defaultEq, enabled: eq.enabled })}>Reset</button>
      </div>
    </section>
  )
}
