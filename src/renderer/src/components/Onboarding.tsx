import { useEffect, useRef } from 'react'
import { useStore } from '@/store'

// First run only: one sheet, two choices, always skippable. Shown once (`onboarded`), never blocks playback.
export function Onboarding(): JSX.Element | null {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const addFolder = useStore((s) => s.addFolder)
  const libraryLoaded = useStore((s) => s.libraryLoaded)
  const empty = useStore((s) => libraryLoaded && s.albums.length === 0)
  const first = useRef<HTMLButtonElement>(null)
  const show = !!settings && !settings.onboarded && libraryLoaded
  const done = (): void => void update({ onboarded: true })

  useEffect(() => {
    if (!show) return undefined
    first.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  if (!show || !settings) return null
  return (
    <div className="scrim">
      <section role="dialog" aria-modal="true" aria-labelledby="ob-title" className="sheet-card">
        <h2 id="ob-title" className="t-display" style={{ margin: 0, fontSize: 28 }}>Welcome to Flacon</h2>
        <p className="ink-2">A player for people who care how their music sounds. Flacon reads your folders, plays lossless audio exactly as recorded, and tells you honestly what each record is.</p>
        {empty && (
          <button ref={first} type="button" className="primary" onClick={() => void addFolder()}>Choose your music folder…</button>
        )}
        {settings.canLaunchAtLogin && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '16px 0' }}>
            <input type="checkbox" checked={settings.launchAtLogin} onChange={(e) => void update({ launchAtLogin: e.target.checked })} />
            Open quietly at login
          </label>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 16 }}>
          <button ref={empty ? undefined : first} type="button" className={empty ? 'ghost-btn' : 'primary'} onClick={done}>{empty ? 'Skip for now' : 'Start listening'}</button>
        </div>
      </section>
    </div>
  )
}
