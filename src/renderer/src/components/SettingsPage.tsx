import { useEffect, useState } from 'react'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'

type Theme = 'system' | 'light' | 'dark'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="set-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {hint && <div className="t-label ink-2" style={{ marginTop: 2 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

export function SettingsPage(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const theme = useStore((s) => s.app?.theme ?? 'system')
  const setTheme = useStore((s) => s.setTheme)
  const addFolder = useStore((s) => s.addFolder)
  const version = useStore((s) => s.libraryVersion)
  const [folders, setFolders] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  useEffect(() => void bridge.libraryFolders().then(setFolders), [version])
  const remove = async (p: string): Promise<void> => {
    setConfirm(null)
    await bridge.libraryRemoveFolder(p)
    setFolders(await bridge.libraryFolders())
  }

  return (
    <>
      <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)' }} />
      <div className="page-head"><h1 className="t-display">Settings</h1></div>
      <div className="fetch-body">
        {settings?.recovered && (
          <p role="status" className="notice">Your settings file was damaged, so Flacon started from the defaults. The damaged copy was kept next to it.</p>
        )}
        <section aria-labelledby="set-general">
          <h2 id="set-general" className="t-label ink-2 set-h">General</h2>
          <Row label="Appearance">
            <div role="radiogroup" aria-label="Appearance" className="seg">
              {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => void setTheme(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
          </Row>
          <Row label="Open at login" hint={settings && !settings.canLaunchAtLogin ? 'Available in the installed app.' : 'Starts quietly in the menu bar; the window stays closed.'}>
            <input type="checkbox" role="switch" aria-label="Open at login" disabled={!settings?.canLaunchAtLogin} checked={!!settings?.launchAtLogin} onChange={(e) => void update({ launchAtLogin: e.target.checked })} />
          </Row>
          <Row label="Pause when the computer sleeps">
            <input type="checkbox" role="switch" aria-label="Pause when the computer sleeps" checked={settings?.pauseOnSuspend ?? true} onChange={(e) => void update({ pauseOnSuspend: e.target.checked })} />
          </Row>
          {settings?.platform === 'win32' && (
            <Row label="Island position" hint="Which screen edge the floating island sits on.">
              <div role="radiogroup" aria-label="Island position" className="seg">
                {(['top', 'bottom'] as const).map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={settings.islandEdge === e} onClick={() => void update({ islandEdge: e })}>{e === 'top' ? 'Top' : 'Bottom'}</button>
                ))}
              </div>
            </Row>
          )}
        </section>
        <section aria-labelledby="set-lib" style={{ marginTop: 32 }}>
          <h2 id="set-lib" className="t-label ink-2 set-h">Library folders</h2>
          {folders === null ? (
            <div className="set-row" aria-busy="true"><span className="skel" style={{ width: '50%' }} /></div>
          ) : folders.length === 0 ? (
            <p className="ink-2" style={{ margin: '12px 0' }}>No folders yet. Add one and Flacon will read it and keep watching for changes.</p>
          ) : (
            <ul className="hits" style={{ marginTop: 4 }}>
              {folders.map((f) => (
                <li key={f} className="hit" style={{ gridTemplateColumns: '1fr auto' }}>
                  <span className="ell" dir="auto" title={f}>{f}</span>
                  {confirm === f ? (
                    <span style={{ display: 'flex', gap: 12 }} role="group" aria-label={`Remove ${f}?`}>
                      <button type="button" className="ghost-btn" style={{ color: 'var(--warn)' }} onClick={() => void remove(f)}>Remove from Flacon</button>
                      <button type="button" className="ghost-btn" onClick={() => setConfirm(null)}>Keep</button>
                    </span>
                  ) : (
                    <button type="button" className="ghost-btn" onClick={() => setConfirm(f)} aria-label={`Remove ${f}`}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="t-label ink-2" style={{ margin: '8px 0 12px' }}>Removing a folder takes its songs out of Flacon. Your files are not touched.</p>
          <button type="button" className="primary" onClick={() => void addFolder().then(async () => setFolders(await bridge.libraryFolders()))}>Add music folder…</button>
        </section>
      </div>
    </>
  )
}
