import { useEffect, useRef, useState } from 'react'
import { useStore, guarded } from '@/store'
import { Rail } from './components/Rail'
import { AlbumCard } from './components/AlbumCard'
import { Vessel } from './components/Vessel'
import { Icon } from './components/icons'

export function App(): JSX.Element {
  const albums = useStore((s) => s.albums)
  const pour = useStore((s) => s.pour)
  const tintHex = useStore((s) => s.albums[0]?.tint)
  const theme = useStore((s) => s.app?.theme ?? 'system')
  const setTheme = useStore((s) => s.setTheme)
  const [over, setOver] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const vesselLeft = (): number => (shellRef.current?.getBoundingClientRect().right ?? 0) - 336

  useEffect(() => {
    shellRef.current?.style.setProperty('--tint', guarded(tintHex))
  }, [tintHex])

  const hi = albums.filter((a) => a.quality === 'hires').length
  const up = albums.filter((a) => a.quality === 'upscaled').length
  const off = albums.filter((a) => a.offline).length

  return (
    <div className="shell" ref={shellRef}>
      <Rail active="Library" />
      <main className="main">
        <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <button type="button" className="search no-drag" aria-label="Search or type a command">
            <Icon name="search" />
            <span style={{ flex: 1, textAlign: 'left' }}>Search or type a command</span>
            <span className="t-label">⌘K</span>
          </button>
        </div>
        <div className="page-head">
          <h1 className="t-display">Library</h1>
          <div role="tablist" className="tabs">
            {['Albums', 'Songs', 'Artists', 'Folders'].map((t, i) => (
              <button key={t} type="button" role="tab" className="tab" aria-selected={i === 0}>{t}</button>
            ))}
          </div>
        </div>
        <div className="meta t-label ink-2">
          <span>{albums.length} albums</span>
          <span>{Math.round((hi / albums.length) * 100)}% verified hi-res</span>
          <span style={{ color: 'var(--warn)' }}>{up} upscaled</span>
          <span>{off} offline</span>
          <button type="button" className="tab" style={{ marginLeft: 'auto', height: 'auto' }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            Theme: {theme}
          </button>
        </div>
        <div className="scroll">
          <div className="grid">
            {albums.map((a) => (
              <AlbumCard
                key={a.id}
                album={a}
                vesselLeft={vesselLeft}
                onDragState={setOver}
                onRelease={(album, x) => {
                  const inside = x > vesselLeft()
                  if (inside) pour(album.id)
                  return inside
                }}
              />
            ))}
          </div>
        </div>
      </main>
      <Vessel over={over} />
    </div>
  )
}
