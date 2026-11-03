import { useEffect, useState } from 'react'
import type { HomeData } from '@shared/library'
import { timecode } from '@shared/library'
import { bridge } from '@/lib/bridge'
import { songMenu } from '@/lib/songActions'
import { useStore } from '@/store'
import { AlbumTile } from './AlbumTile'
import { Icon } from './icons'
import { PurityMeter } from './Purity'

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function SongList({ songs, label }: { songs: HomeData['onRepeat']; label: string }): JSX.Element {
  const play = useStore((s) => s.play)
  const openMenu = useStore((s) => s.openMenu)
  const paths = songs.map((s) => s.path)
  return (
    <ul className="mini" aria-label={label}>
      {songs.map((s, i) => (
        <li key={s.path}>
          <button type="button" className="mini-row" disabled={s.offline} onClick={() => void play({ source: { kind: 'paths', paths }, mode: 'play', index: i })} onContextMenu={(e) => openMenu(e, songMenu([s]))}>
            <span className="t-label ink-2 num">{i + 1}</span>
            <i className="thumb" style={{ background: s.sleeve }} />
            <span style={{ minWidth: 0, textAlign: 'start' }}>
              <span className="ell" dir="auto" style={{ display: 'block', fontWeight: 600 }}>{s.title}</span>
              <span className="ell ink-2" dir="auto" style={{ display: 'block', fontSize: 13 }}>{s.artist}</span>
            </span>
            <span className="t-label ink-2">{s.playCount > 0 ? `${s.playCount}×` : ''}</span>
            <PurityMeter f={s} width={36} />
            <span className="t-label ink-2">{timecode(s.durationSec)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** "Tonight": what to put on. Everything here is computed from your own library and listening. */
export function HomePage(): JSX.Element {
  const [home, setHome] = useState<HomeData | null>(null)
  const libraryVersion = useStore((s) => s.libraryVersion)
  const activity = useStore((s) => s.activityVersion)
  const albums = useStore((s) => s.albums)
  const loaded = useStore((s) => s.libraryLoaded)
  const addFolder = useStore((s) => s.addFolder)
  const play = useStore((s) => s.play)
  const openList = useStore((s) => s.openList)
  const setPage = useStore((s) => s.setPage)
  const pbTrack = useStore((s) => s.pb.track)

  useEffect(() => {
    let live = true
    void bridge.libraryCall<HomeData>({ op: 'home' }).then((h) => live && setHome(h)).catch(() => undefined)
    return () => { live = false }
  }, [libraryVersion, activity])

  const empty = loaded && albums.length === 0
  if (empty) {
    return (
      <>
        <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', flexShrink: 0 }} />
        <div className="empty" role="status">
          <h1 className="t-display" style={{ margin: 0 }}>{greeting()}.</h1>
          <p className="ink-2">Add a folder and Flacon reads it, measures how pure each song really is, and builds your shelves from what you play.</p>
          <button type="button" className="primary" onClick={() => void addFolder()}>Add music folder…</button>
        </div>
      </>
    )
  }
  const r = home?.review
  return (
    <>
      <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', flexShrink: 0 }} />
      <div className="page-scroll">
        <header className="home-head">
          <h1 className="t-display" style={{ margin: 0 }}>{greeting()}.</h1>
          <div className="home-actions">
            <button type="button" className="primary" style={{ marginTop: 0 }} onClick={() => void play({ source: { kind: 'scope', scope: 'all', text: '' }, mode: 'shuffle' })}><Icon name="shuffle" size={16} /> Shuffle library</button>
            {pbTrack && <span className="t-label ink-2">Now playing: {pbTrack.title}</span>}
          </div>
        </header>

        {home && home.jumpBackIn.length > 0 && (
          <section className="shelf-sec" aria-labelledby="sh-jump"><h2 id="sh-jump" className="t-title">Jump back in</h2><div className="shelf">{home.jumpBackIn.map((a) => <AlbumTile key={a.id} album={a} />)}</div></section>
        )}
        {home && home.onRepeat.length > 0 && (
          <section className="shelf-sec" aria-labelledby="sh-rep"><h2 id="sh-rep" className="t-title">On repeat</h2><SongList songs={home.onRepeat} label="Most played songs" /></section>
        )}
        {home && home.recentlyAdded.length > 0 && (
          <section className="shelf-sec" aria-labelledby="sh-new">
            <div className="sec-head"><h2 id="sh-new" className="t-title">Recently added</h2><button type="button" className="ghost-btn" onClick={() => setPage('library')}>See all</button></div>
            <div className="shelf">{home.recentlyAdded.map((a) => <AlbumTile key={a.id} album={a} />)}</div>
          </section>
        )}
        {home && home.forgotten.length > 0 && (
          <section className="shelf-sec" aria-labelledby="sh-forg"><h2 id="sh-forg" className="t-title">Forgotten favourites</h2><SongList songs={home.forgotten} label="Favourites you haven't played lately" /></section>
        )}
        {r && r.total > 0 && (
          <section className="shelf-sec" aria-labelledby="sh-pur">
            <h2 id="sh-pur" className="t-title">Library purity</h2>
            <div className="purity-card">
              <div className="t-readout" aria-label={r.avgPurity === null ? 'Not measured yet' : `${r.avgPurity} percent average purity`}>{r.avgPurity === null ? '—' : `${r.avgPurity}%`}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.measured < r.total ? `Measured ${r.measured.toLocaleString()} of ${r.total.toLocaleString()} songs so far` : `Measured ${r.measured.toLocaleString()} songs`}</div>
                <div className="ink-2" style={{ fontSize: 13 }}>Average share of each song’s frequency range that holds real music.{r.upscaled > 0 ? ` ${r.upscaled.toLocaleString()} look upscaled or padded.` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                {r.upscaled > 0 && <button type="button" className="ghost-btn" onClick={() => openList('upscaled')}>Review</button>}
                <button type="button" className="ghost-btn" onClick={() => openList('verified')}>Verified songs</button>
              </div>
            </div>
          </section>
        )}
        {home && home.jumpBackIn.length === 0 && home.onRepeat.length === 0 && (
          <p className="ink-2" style={{ marginTop: 24 }}>Play something and this page starts to fill in: what you’ve been listening to, what’s on repeat, what you’ve forgotten.</p>
        )}
      </div>
    </>
  )
}
