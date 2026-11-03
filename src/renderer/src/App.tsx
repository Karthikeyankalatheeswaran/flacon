import { useEffect, useRef, useState } from 'react'
import { useStore, guarded } from '@/store'
import { Rail } from './components/Rail'
import { AlbumGrid } from './components/AlbumGrid'
import { Vessel } from './components/Vessel'
import { Icon } from './components/icons'
import { FetchPage } from './components/FetchPage'
import { EqPanel } from './components/EqPanel'
import { SongsTable } from './components/SongsTable'

const TABS = ['Albums', 'Songs', 'Artists', 'Folders'] as const
type Tab = (typeof TABS)[number]

export function App(): JSX.Element {
  const { albums, libraryLoaded, search, setSearch, addFolder, playAlbum, pour } = useStore()
  const tintHex = useStore((s) => s.albums[0]?.tint)
  const theme = useStore((s) => s.app?.theme ?? 'system')
  const setTheme = useStore((s) => s.setTheme)
  const scanning = useStore((s) => s.progress.phase === 'scanning')
  const eqOpen = useStore((s) => s.eqOpen)
  const page = useStore((s) => s.page)
  const [over, setOver] = useState(false)
  const [tab, setTab] = useState<Tab>('Albums')
  const shellRef = useRef<HTMLDivElement>(null)
  const vesselLeft = (): number => (shellRef.current?.getBoundingClientRect().right ?? 0) - 336

  useEffect(() => {
    shellRef.current?.style.setProperty('--tint', guarded(tintHex))
  }, [tintHex])

  const hi = albums.filter((a) => a.quality === 'hires').length
  const up = albums.filter((a) => a.quality === 'upscaled').length
  const off = albums.filter((a) => a.offline).length
  const empty = libraryLoaded && albums.length === 0

  return (
    <div className="shell" ref={shellRef}>
      <Rail active={page === 'fetch' ? 'Fetch' : 'Library'} />
      <main className="main">
        {page === 'fetch' ? <FetchPage /> : (
        <>
        <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <label className="search no-drag">
            <Icon name="search" />
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your library"
              aria-label="Search your library" spellCheck={false}
            />
            <span className="t-label">⌘K</span>
          </label>
        </div>
        <div className="page-head">
          <h1 className="t-display">{tab === 'Songs' ? 'Songs' : 'Library'}</h1>
          <div role="tablist" className="tabs">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" className="tab" aria-selected={t === tab} onClick={() => (t === 'Albums' || t === 'Songs') && setTab(t)}
                disabled={t === 'Artists' || t === 'Folders'} title={t === 'Artists' || t === 'Folders' ? 'Coming soon' : undefined}>{t}</button>
            ))}
          </div>
        </div>
        {tab === 'Songs' ? (
          <SongsTable text={search} />
        ) : (
          <>
        <div className="meta t-label ink-2">
          <span>{albums.length.toLocaleString()} albums</span>
          {albums.length > 0 && <span>{Math.round((hi / albums.length) * 100)}% verified hi-res</span>}
          {up > 0 && <span style={{ color: 'var(--warn)' }}>{up} upscaled</span>}
          {off > 0 && <span>{off} offline</span>}
          <button type="button" className="tab" style={{ marginLeft: 'auto', height: 'auto' }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            Theme: {theme}
          </button>
        </div>
        {!libraryLoaded ? (
          <div className="grid" aria-busy="true" aria-label="Loading library">
            {/* Skeletons sized exactly like the cards they replace: no layout shift. */}
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="card" style={{ cursor: 'default' }}>
                <div className="sleeve" style={{ background: 'var(--well)' }} />
                <div style={{ height: 20, marginTop: 12, background: 'var(--well)', width: '70%' }} />
                <div style={{ height: 20, background: 'var(--rule-2)', width: '45%', marginTop: 0 }} />
              </div>
            ))}
          </div>
        ) : empty ? (
          <div className="empty" role="status">
            {search.trim() ? (
              <>
                <h2 className="t-title">Nothing matches “{search}”</h2>
                <p className="ink-2">Check the spelling, or try an artist or album name. Accents and case don’t matter.</p>
              </>
            ) : scanning ? (
              <>
                <h2 className="t-title">Reading your music…</h2>
                <p className="ink-2">Albums appear here as they are found.</p>
              </>
            ) : (
              <>
                <h2 className="t-title">Add a folder to begin</h2>
                <p className="ink-2">Flacon reads FLAC, ALAC, WAV, AIFF, DSD and more, and measures how much of each record is really there.</p>
                <button type="button" className="primary" onClick={() => void addFolder()}>Add music folder…</button>
              </>
            )}
          </div>
        ) : (
          <AlbumGrid albums={albums} vesselLeft={vesselLeft} onDragState={setOver}
            onPour={pour} onPlay={(a) => void playAlbum(a.id)} />
        )}
          </>
        )}
        </>
        )}
      </main>
      <Vessel over={over} />
      {eqOpen && <EqPanel />}
    </div>
  )
}
