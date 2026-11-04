import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { placeholderSleeve, timecode } from '@shared/library'
import { hueTint } from '@shared/tags'
import '@fontsource-variable/archivo/wght.css'
import './styles/tokens.css'
import './styles/mini.css'
import { bridge } from './lib/bridge'
import { guarded, initApp, useStore } from './store'
import { Icon } from './components/icons'

/** The mini player (board C14): tinted by the playing record, sleeve + title, a progress pill with both times, and the transport. */
function Mini(): JSX.Element {
  const pb = useStore((s) => s.pb)
  const albums = useStore((s) => s.albums)
  const send = useStore((s) => s.send)
  const np = pb.track
  const meta = pb.meta
  const playing = pb.status === 'playing'
  const dur = np?.durationSec ?? 0
  const [drag, setDrag] = useState<number | null>(null)
  const [pinned, setPinned] = useState(true)
  const shown = drag ?? pb.positionSec
  // The record's own tint when the library knows it; otherwise the same title-derived colour the placeholder sleeve uses.
  const tint = guarded(albums.find((a) => a.title === meta?.album)?.tint ?? (np ? hueTint(np.title) : undefined))
  const sub = np ? [meta?.artist, np.bitDepth ? `${np.bitDepth}/${np.sampleRate / 1000}` : `${np.sampleRate / 1000} kHz`].filter(Boolean).join(' · ') : 'Pick something in Flacon'
  const commit = (): void => { if (drag !== null) send({ type: 'seek', seconds: drag }); setDrag(null) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ' ' && !(e.target as HTMLElement).closest('input,button')) { e.preventDefault(); send({ type: 'toggle' }) }
      if (e.key === 'Escape') bridge.mini('close')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [send])

  return (
    <main className="mini" aria-label="Mini player" style={{ ['--mini-tint' as string]: tint }}>
      <header className="mini-head">
        <div className="mini-art" role="img" aria-label={meta?.album ? `Cover of ${meta.album}` : 'Album cover'} style={{ background: meta?.artUrl ? `center / cover url("${meta.artUrl}")` : placeholderSleeve(tint) }} />
        <div className="mini-text">
          <div className="mini-title" dir="auto" title={np?.title}>{np?.title ?? 'Nothing playing'}</div>
          <div className="mini-sub t-label" dir="auto" title={sub}>{sub}</div>
        </div>
        <div className="mini-tools">
          <button type="button" className={`mini-tool t-label${pinned ? ' on' : ''}`} aria-pressed={pinned} title="Keep the mini player above other windows" onClick={() => { setPinned(!pinned); bridge.mini(pinned ? 'unpin' : 'pin') }}>On top</button>
          <button type="button" className="mini-ibtn" aria-label="Open Flacon" title="Open Flacon" onClick={() => bridge.mini('expand')}><Icon name="arrows-out-simple" size={14} /></button>
          <button type="button" className="mini-ibtn" aria-label="Close mini player" title="Close" onClick={() => bridge.mini('close')}><Icon name="close" size={14} /></button>
        </div>
      </header>
      <div className="mini-prog" style={{ ['--p' as string]: dur ? Math.min(1, shown / dur) : 0 }}>
        <input type="range" aria-label="Seek" aria-valuetext={`${timecode(shown)} of ${timecode(dur)}`} min={0} max={Math.max(1, Math.round(dur))} step={1} value={Math.round(Math.min(shown, dur || 0))} disabled={!np}
          onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} />
        <span className="t-label mini-t l" aria-hidden>{timecode(shown)}</span>
        <span className="t-label mini-t r" aria-hidden>−{timecode(Math.max(0, dur - shown))}</span>
      </div>
      <div className="mini-ctl">
        <button type="button" className="mini-btn" aria-label="Previous" disabled={!np} onClick={() => send({ type: 'prev' })}><Icon name="prev" size={18} filled /></button>
        <button type="button" className="mini-btn big" aria-label={playing ? 'Pause' : 'Play'} disabled={!np} onClick={() => send({ type: 'toggle' })}><Icon name={playing ? 'pause' : 'play'} size={18} filled /></button>
        <button type="button" className="mini-btn" aria-label="Next" disabled={!np} onClick={() => send({ type: 'next' })}><Icon name="next" size={18} filled /></button>
      </div>
    </main>
  )
}

initApp()
createRoot(document.getElementById('root')!).render(<StrictMode><Mini /></StrictMode>)
