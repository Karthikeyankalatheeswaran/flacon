import { useEffect, useRef, useState } from 'react'
import { timecode } from '@shared/library'
import { purityBadge, purityDetail } from '@shared/purity'
import { sliderLabel } from '@shared/playback'
import { hueTint } from '@shared/tags'
import { guarded, useStore } from '@/store'
import { Icon } from './icons'
import { PurityMeter, purityColor } from './Purity'
import { QueuePanel } from './QueuePanel'
import { LyricsPanel } from './LyricsPanel'

function spec(t: { sampleRate: number; bitDepth: number | null; codec: string; path: string }): string {
  const dsd = /\.(dsf|dff)$/i.test(t.path) ? 'DSD→PCM · ' : ''
  const bits = t.bitDepth ? `${t.bitDepth} bit · ` : ''
  return `${dsd}${bits}${(t.sampleRate / 1000).toString().replace(/\.0+$/, '')} kHz · ${t.codec.toUpperCase()}`
}

// The vessel: now-playing sleeve, transport, and the queue / lyrics. Tinted by the playing record.
export function Vessel({ over }: { over: boolean }): JSX.Element {
  const { pb, send, openFiles, eqOpen, setEqOpen, vesselTab, setVesselTab, toggleFavorite } = useStore()
  const t = pb.track
  const meta = pb.meta
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

  const commit = (): void => {
    if (drag !== null) send({ type: 'seek', seconds: drag })
    setDrag(null)
  }
  const nextRepeat = pb.repeat === 'off' ? 'all' : pb.repeat === 'all' ? 'one' : 'off'
  const bg = guarded(t ? hueTint(meta?.album || t.title) : undefined)
  const facts = meta ? { purity: meta.purity, lossless: meta.lossless, ceilingKhz: meta.ceilingKhz, effBits: meta.effBits, bitDepth: meta.bitDepth, upscaled: meta.upscaled } : null

  return (
    <aside className={`vessel${over ? ' over' : ''}`} aria-label="Now playing and queue" style={{ ['--vessel-bg' as string]: t ? bg : undefined }}>
      <div style={{ height: 'var(--shell-titlebar)', flexShrink: 0 }} />
      {t ? (
        <>
          <div className="vessel-sleeve" role="img" aria-label={meta?.album ? `Artwork for ${meta.album}` : 'No artwork'}
            style={{ background: meta?.artUrl ? `url("${meta.artUrl}") center/cover no-repeat, ${bg}` : 'linear-gradient(135deg,rgb(237 237 232 / .16),rgb(237 237 232 / .04))' }} />
          <div className="vessel-title">
            <div style={{ minWidth: 0 }}>
              <div className="t-title ell" dir="auto" title={t.title}>{t.title}</div>
              <div className="ell dim" dir="auto" style={{ fontSize: 13 }}>{meta?.artist || 'Unknown artist'}{meta?.album ? ` · ${meta.album}` : ''}</div>
            </div>
            {meta && (
              <button type="button" className={`heart on-dark${meta.favorite ? ' on' : ''}`} aria-pressed={meta.favorite} aria-label={meta.favorite ? 'Remove from Favourites' : 'Add to Favourites'} onClick={() => toggleFavorite(meta.path, !meta.favorite)}>
                <Icon name="heart" size={22} filled={meta.favorite} />
              </button>
            )}
          </div>
          <div className="vessel-quality" title={facts ? purityDetail({ ...facts }) : undefined}>
            {facts ? <PurityMeter f={facts} width={72} label={false} /> : null}
            <span className="t-label" style={{ color: 'inherit' }}>{facts ? <b style={{ color: purityColor(facts) === 'var(--ink)' ? 'inherit' : undefined }}>{purityBadge(facts)}</b> : null}{facts ? ' · ' : ''}{spec(t)}</span>
          </div>
          <div className="scrub" style={{ marginTop: 10 }}>
            <input
              type="range" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.floor(shown)}
              aria-label="Position" aria-valuetext={`${timecode(shown)} of ${timecode(dur)}`}
              onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit}
            />
            <div className="t-label dim" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{timecode(shown)}</span><span>−{timecode(Math.max(0, dur - shown))}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="vessel-empty">
          <Icon name="album" size={40} />
          <p className="t-label dim" style={{ margin: '12px 0 0', maxWidth: 220 }}>Nothing playing. Double-click a song, or drag an album here to queue it.</p>
        </div>
      )}
      <div className="vessel-transport">
        <button type="button" className={`vbtn${pb.shuffle ? ' lit' : ''}`} aria-label="Shuffle" aria-pressed={pb.shuffle} title="Shuffle" onClick={() => send({ type: 'shuffle', on: !pb.shuffle })}><Icon name="shuffle" size={20} /></button>
        <button type="button" className="vbtn" aria-label="Previous" onClick={() => send({ type: 'prev' })}><Icon name="prev" size={22} filled /></button>
        <button type="button" className="pb" aria-label={playing ? 'Pause' : 'Play'} onClick={() => send({ type: 'toggle' })} disabled={pb.queueLength === 0 && !t}>
          <Icon name={playing ? 'pause' : 'play'} size={22} filled />
        </button>
        <button type="button" className="vbtn" aria-label="Next" onClick={() => send({ type: 'next' })}><Icon name="next" size={22} filled /></button>
        <button type="button" className={`vbtn${pb.repeat !== 'off' ? ' lit' : ''}`} aria-label={`Repeat: ${pb.repeat}. Switch to ${nextRepeat}.`} title={`Repeat ${pb.repeat}`} onClick={() => send({ type: 'repeat', mode: nextRepeat })}><Icon name={pb.repeat === 'one' ? 'repeatOne' : 'repeat'} size={20} /></button>
      </div>
      <div className="vessel-vol scrub">
        <Icon name={pb.volume <= 0 ? 'mute' : pb.volume < 0.5 ? 'volumeLow' : 'volume'} size={16} />
        <input type="range" min={0} max={1} step={0.01} value={pb.volume} aria-label="Volume" aria-valuetext={sliderLabel(pb.volume)} onChange={(e) => send({ type: 'volume', slider: Number(e.target.value) })} />
        <span className="t-label dim vol-read">{sliderLabel(pb.volume)}</span>
      </div>
      <div className="vessel-tabs">
        <div role="tablist" aria-label="Panel" style={{ display: 'flex' }}>
          <button type="button" role="tab" className="vtab" aria-selected={vesselTab === 'queue'} onClick={() => setVesselTab('queue')}><Icon name="queue" size={16} /> Up next</button>
          <button type="button" role="tab" className="vtab" aria-selected={vesselTab === 'lyrics'} onClick={() => setVesselTab('lyrics')}><Icon name="lyrics" size={16} /> Lyrics</button>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button type="button" className={`vbtn${eqOpen ? ' lit' : ''}`} style={{ width: 32, height: 32 }} aria-label="Equalizer" aria-pressed={eqOpen} title={`Equalizer${pb.eq.enabled ? ' (on)' : ''}`} onClick={() => setEqOpen(!eqOpen)}><Icon name="eq" size={18} /></button>
          <button type="button" className="vbtn" style={{ width: 32, height: 32 }} aria-label="Open files" title="Open files…" onClick={() => void openFiles()}><Icon name="folder-open" size={18} /></button>
        </span>
      </div>
      <div className="vessel-panel" role="tabpanel">
        {vesselTab === 'queue' ? <QueuePanel /> : <LyricsPanel />}
      </div>
      <div role="status" aria-live="polite" className="sr-only">{t ? `Now playing ${t.title}` : ''}</div>
      {toastShown && <div role="alert" className="toast">{toastShown}</div>}
    </aside>
  )
}
