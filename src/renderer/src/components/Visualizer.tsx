import { useEffect, useRef } from 'react'
import { VIZ_BARS, smooth } from '@shared/spectrum'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'

/** Live spectrum of what is playing: 48 hairline bars, low on the left. Drawn on a canvas; the engine only analyses while this is open. */
export function Visualizer(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const playing = useStore((s) => s.pb.status === 'playing')
  const rate = useStore((s) => s.pb.outputRate)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const g = canvas.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let bars: Float32Array = new Float32Array(VIZ_BARS)
    let caps = new Float32Array(VIZ_BARS)
    let latest: Uint8Array | null = null
    let raf = 0
    let last = 0
    const css = (v: string): string => getComputedStyle(canvas).getPropertyValue(v).trim() || '#888'

    bridge.vizSubscribe(true)
    const off = bridge.onViz((b) => { latest = b })

    const draw = (t: number): void => {
      raf = requestAnimationFrame(draw)
      if (reduce && t - last < 160) return // reduced motion: a few frames a second, no smoothing glide
      last = t
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      bars = smooth(bars, latest ?? new Uint8Array(VIZ_BARS), reduce ? 1 : 0.1)
      const ink = css('--v-strong'), dim = css('--v-ink'), accent = css('--accent')
      const slot = w / VIZ_BARS
      const bw = Math.max(1.5, Math.min(3, slot * 0.5))
      // hairline baseline
      g.fillStyle = dim; g.globalAlpha = 0.25; g.fillRect(0, h - 1, w, 1); g.globalAlpha = 1
      for (let i = 0; i < VIZ_BARS; i++) {
        const v = bars[i]!
        const bh = Math.max(1, v * (h - 6))
        const x = i * slot + (slot - bw) / 2
        g.fillStyle = ink; g.globalAlpha = 0.85
        g.fillRect(x, h - 1 - bh, bw, bh)
        caps[i] = Math.max(v, (caps[i] ?? 0) - 0.006)
        g.fillStyle = accent; g.globalAlpha = 1
        g.fillRect(x, h - 1 - Math.max(1, caps[i]! * (h - 6)) - 3, bw, 1.5)
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); off(); bridge.vizSubscribe(false) }
  }, [])

  return (
    <div className="viz">
      <canvas ref={ref} className="viz-canvas" role="img" aria-label={playing ? 'Live spectrum of the song playing' : 'Spectrum, paused'} />
      <div className="viz-axis t-label dim" aria-hidden="true">
        <span>40 Hz</span><span>500</span><span>2 k</span><span>{rate && rate < 32000 ? `${Math.round(rate / 2000)} k` : '16 kHz'}</span>
      </div>
      <p className="t-label dim viz-note">{playing ? 'What you hear, by frequency.' : 'Press play to see the spectrum.'}</p>
    </div>
  )
}
