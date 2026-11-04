import { useEffect, useRef, useState } from 'react'
import { useStore, guarded } from '@/store'
import { isInteractiveTarget, tabKeys } from '@/lib/a11y'
import { Rail } from './components/Rail'
import { AlbumGrid } from './components/AlbumGrid'
import { Vessel } from './components/Vessel'
import { Icon } from './components/icons'
import { SettingsPage } from './components/SettingsPage'
import { Onboarding } from './components/Onboarding'
import { FetchPage } from './components/FetchPage'
import { EqPanel } from './components/EqPanel'
import { SongsTable } from './components/SongsTable'
import { ArtistsView } from './components/ArtistsView'
import { FoldersView } from './components/FoldersView'
import { HomePage } from './components/HomePage'
import { ListPage } from './components/ListPage'
import { PlaylistsPage } from './components/PlaylistsPage'
import { DuplicatesPage } from './components/DuplicatesPage'
import { ReportSheet } from './components/ReportSheet'
import { StatsPage } from './components/StatsPage'
import { ContextMenu } from './components/ContextMenu'
import { Sheets } from './components/Sheets'
import { Toasts } from './components/Toast'
import { DropZone } from './components/DropZone'
import { AddMusic } from './components/AddMusic'
import { bridge } from '@/lib/bridge'

const TABS = ['Albums', 'Songs', 'Artists', 'Folders'] as const
type Tab = (typeof TABS)[number]

export function App(): JSX.Element {
  const { albums, libraryLoaded, search, setSearch, playAlbum, pour, play } = useStore()
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

  const searchRef = useRef<HTMLInputElement>(null)
  const send = useStore((s) => s.send)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useStore.getState().setPage('library')
        window.setTimeout(() => searchRef.current?.focus(), 0)
      } else if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey && !isInteractiveTarget(e.target)) {
        e.preventDefault() // Space plays/pauses unless a control has focus and wants the key
        send({ type: 'toggle' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [send])

  useEffect(() => {
    shellRef.current?.style.setProperty('--tint', guarded(tintHex))
  }, [tintHex])

  // The native menu (and the tray) ask the UI to navigate or open things.
  const showLyrics = useStore((s) => s.settings?.showLyrics)
  const lyricsSeeded = useRef(false)
  useEffect(() => {
    if (showLyrics === undefined || lyricsSeeded.current) return
    lyricsSeeded.current = true
    if (showLyrics) useStore.getState().setVesselTab('lyrics')
  }, [showLyrics])
  useEffect(() => bridge.onMenuAction((a) => {
    const st = useStore.getState()
    if (a.startsWith('go:')) st.setPage(a.slice(3) as Parameters<typeof st.setPage>[0])
    else if (a === 'new-playlist') st.setSheet({ kind: 'new-playlist', paths: [] })
    else if (a === 'toggle-eq') st.setEqOpen(!st.eqOpen)
    else if (a === 'report-problem') st.setReportOpen(true)
    else if (a === 'toggle-queue') st.setVesselTab('queue')
    else if (a === 'toggle-visualizer') st.setVesselTab(st.vesselTab === 'viz' ? 'queue' : 'viz')
    else if (a === 'toggle-lyrics') {
      const on = st.vesselTab !== 'lyrics'
      st.setVesselTab(on ? 'lyrics' : 'queue')
      void st.updateSettings({ showLyrics: on })
    } else if (a === 'focus-search') {
      st.setPage('library')
      window.setTimeout(() => searchRef.current?.focus(), 50)
    } else if (a === 'add-folder') void st.addFolder()
    else if (a.startsWith('toast:')) st.showToast(a.slice(6))
  }), [])

  const hi = albums.filter((a) => a.quality === 'hires').length
  const up = albums.filter((a) => a.quality === 'upscaled').length
  const off = albums.filter((a) => a.offline).length
  const empty = libraryLoaded && albums.length === 0

  return (
    <div className="shell" ref={shellRef}>
      <a className="skip" href="#content" onClick={(e) => { e.preventDefault(); document.getElementById('content')?.focus() }}>Skip to content</a>
      <Rail />
      <main className="main" id="content" tabIndex={-1}>
        {page === 'home' ? <HomePage /> : page === 'fetch' ? <FetchPage /> : page === 'settings' ? <SettingsPage /> : page === 'stats' ? <StatsPage /> : page === 'duplicates' ? <DuplicatesPage /> : page === 'playlists' ? <PlaylistsPage /> : page === 'list' ? <ListPage /> : (
        <>
        <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
          <label className="search no-drag">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your library"
              aria-label="Search your library" spellCheck={false}
            />
            <span className="t-label">⌘K</span>
          </label>
        </div>
        <div className="page-head">
          <h1 className="t-display">{tab === 'Songs' ? 'Songs' : 'Library'}</h1>
          <div role="tablist" className="tabs" onKeyDown={tabKeys}>
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" className="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>
        {tab === 'Songs' ? (
          <SongsTable text={search} />
        ) : tab === 'Folders' ? (
          <FoldersView />
        ) : tab === 'Artists' ? (
          <ArtistsView albums={albums} vesselLeft={vesselLeft} onDragState={setOver} onPour={pour} onPlay={(a) => void playAlbum(a.id)} />
        ) : (
          <>
        <div className="meta t-label ink-2">
          <span>{albums.length.toLocaleString()} albums</span>
          {albums.length > 0 && <span>{Math.round((hi / albums.length) * 100)}% hi-res</span>}
          {up > 0 && <span style={{ color: 'var(--warn)' }}>{up} upscaled</span>}
          {off > 0 && <span>{off} offline</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
            <AddMusic />
            <button type="button" className="ghost-btn" disabled={albums.length === 0} onClick={() => void play({ source: { kind: 'scope', scope: 'all', text: search }, mode: 'shuffle' })}><Icon name="shuffle" size={16} /> Shuffle all</button>
            <button type="button" className="ghost-btn" aria-label={`Appearance: ${theme}. Switch to ${theme === 'dark' ? 'light' : 'dark'}.`} title="Toggle light / dark" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <Icon name={theme === 'dark' ? 'sunIcon' : 'moonIcon'} size={16} />
            </button>
          </span>
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
                <h2 className="t-title">Add your music</h2>
                <p className="ink-2">Choose a folder, or just drag one onto this window. Flacon reads FLAC, ALAC, WAV, AIFF, DSD and more, and measures how much of each record is really there.</p>
                <AddMusic primary />
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
      <Onboarding />
      <ContextMenu />
      <Sheets />
      <ReportSheet />
      <Toasts />
      <DropZone />
    </div>
  )
}
