import { useEffect, useRef, useState } from 'react'
import { durationLabel, timecode } from '@shared/library'
import { sliderLabel } from '@shared/playback'
import { useStore } from '@/store'
import { Icon } from './icons'

function spec(t: { sampleRate: number; bitDepth: number | null; codec: string; path: string }): string {
  const dsd = /\.(dsf|dff)$/i.test(t.path) ? 'DSD→PCM · ' : ''
  const bits = t.bitDepth ? `${t.bitDepth} bit · ` : ''
  return `${dsd}${bits}${(t.sampleRate / 1000).toString().replace(/\.0+$/, '')} kHz · ${t.codec.toUpperCase()}`
}

// The vessel: now-playing sleeve + the queue you "pour" albums into. Tinted by the playing record.
export function Vessel({ over }: { over: boolean }): JSX.Element {
  const { albums, queue, pb, send, openFiles } = useStore()
  const total = queue.reduce((s, id) => s + (albums.find((a) => a.id === id)?.minutes ?? 0), 0)
  const t = pb.track
  const playing = pb.status === 'playing'
  const dur = t?.durationSec ?? 0

  // Scrubber: drag updates locally, commits one seek on release (each seek is a new decode).
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? pb.positionSec
  const toast = pb.toast
  const [toastShown, setToastShown] = useState<string | null>(null)
  const lastToast = useRef<string | null>(null)
  useEffect(() => {
    if (toast && toast !== lastToast.current) {
      lastToast.current = toast
      setToastShown(toast)
      const id = window.setTimeout(() => setToastShown(null), 5000)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [toast])

  return (
    <aside className={`vessel${over ? ' over' : ''}`} aria-label="Vessel — now playing and queue">
      <div style={{ height: 'var(--shell-titlebar)' }} />
      {t ? (
        <>
          <div className="vessel-sleeve" role="img" aria-label="Sleeve" style={{ background: 'linear-gradient(135deg,rgb(237 237 232 / .14),rgb(237 237 232 / .04))' }} />
          <div className="t-title" style={{ marginTop: 16 }} dir="auto">{t.title}</div>
          <div className="t-label dim">{spec(t)}</div>
          <div className="scrub" style={{ marginTop: 16 }}>
            <input
              type="range" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.floor(shown)}
              aria-label="Position" aria-valuetext={`${timecode(shown)} of ${timecode(dur)}`}
              onChange={(e) => setDrag(Number(e.target.value))}
              onPointerUp={() => { if (drag !== null) send({ type: 'seek', seconds: drag }); setDrag(null) }}
              onKeyUp={() => { if (drag !== null) send({ type: 'seek', seconds: drag }); setDrag(null) }}
            />
            <div className="t-label dim" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{timecode(shown)}</span><span>−{timecode(Math.max(0, dur - shown))}</span>
            </div>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 24 }}>
          <p className="t-label dim" style={{ margin: 0 }}>Nothing poured yet. Drag an album here, or open files.</p>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
        <button type="button" className="ghost-btn" aria-label="Previous" onClick={() => send({ type: 'prev' })}><Icon name="prev" size={20} filled /></button>
        <button type="button" className="pb" aria-label={playing ? 'Pause' : 'Play'} onClick={() => send({ type: 'toggle' })} disabled={pb.queueLength === 0 && !t}>
          <Icon name={playing ? 'pause' : 'play'} size={22} filled={!playing} />
        </button>
        <button type="button" className="ghost-btn" aria-label="Next" onClick={() => send({ type: 'next' })}><Icon name="next" size={20} filled /></button>
        <button type="button" className="ghost-btn" style={{ marginLeft: 'auto' }} onClick={() => void openFiles()}>Open files…</button>
      </div>
      <div className="scrub" style={{ marginTop: 16 }}>
        <input type="range" min={0} max={1} step={0.01} value={pb.volume} aria-label="Volume" aria-valuetext={sliderLabel(pb.volume)}
          onChange={(e) => send({ type: 'volume', slider: Number(e.target.value) })} />
        <div className="t-label dim" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Volume {sliderLabel(pb.volume)}</span>
          {pb.outputRate > 0 && <span>Output {(pb.outputRate / 1000).toString()} kHz · processed</span>}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 }} className="t-label dim">
        <span>Queue · {queue.length}</span>
        <span>{durationLabel(total)}</span>
      </div>
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {queue.map((id) => {
          const a = albums.find((x) => x.id === id)
          if (!a) return null
          return (
            <div key={id} className="vessel-row">
              <div className="th" style={{ background: a.sleeve }} />
              <div style={{ minWidth: 0 }}>
                <div className="line1" style={{ fontWeight: 600 }} dir="auto">{a.title}</div>
                <div className="t-label dim">{durationLabel(a.minutes)}</div>
              </div>
            </div>
          )
        })}
      </div>
      <div role="status" aria-live="polite" className="sr-only">{t ? `Now playing ${t.title}` : ''}</div>
      {toastShown && <div role="alert" className="toast">{toastShown}</div>}
    </aside>
  )
}
