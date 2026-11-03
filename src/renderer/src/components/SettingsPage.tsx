import { useEffect, useState } from 'react'
import { describeUpdate } from '@shared/update'
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

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }): JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="seg">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
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
  const upd = useStore((s) => s.update)
  const analysis = useStore((s) => s.analysis)
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
        </section>
        <section aria-labelledby="set-play" style={{ marginTop: 32 }}>
          <h2 id="set-play" className="t-label ink-2 set-h">Playback</h2>
          <Row label="ReplayGain" hint="Levels loud and quiet records using the gain tags in your files. Songs without tags play untouched; nothing is ever boosted into clipping.">
            <Seg label="ReplayGain" value={settings?.replayGain ?? 'off'} options={[['off', 'Off'], ['track', 'Track']]} onChange={(v) => void update({ replayGain: v })} />
          </Row>
          <Row label="Crossfade" hint="Overlaps the end of one song with the start of the next. Off keeps playback gapless with no fade. Skipping or seeking never crossfades.">
            <Seg label="Crossfade" value={String(settings?.crossfade ?? 0)} options={[['0', 'Off'], ['3', '3 s'], ['6', '6 s'], ['10', '10 s']]} onChange={(v) => void update({ crossfade: Number(v) })} />
          </Row>
          <Row label="Purity measuring" hint="Flacon decodes a short sample of every lossless song in the background to see how much of its frequency range is real. Nothing leaves your computer.">
            <span className="t-label ink-2" role="status">{analysis.total > analysis.done ? `${analysis.done.toLocaleString()} of ${analysis.total.toLocaleString()}` : 'Up to date'}</span>
          </Row>
        </section>
        <section aria-labelledby="set-isl" style={{ marginTop: 32 }}>
          <h2 id="set-isl" className="t-label ink-2 set-h">Flacon Island</h2>
          <Row label="Show the island" hint="A small floating player at the top of the screen. Hover to open it, click to expand.">
            <input type="checkbox" role="switch" aria-label="Show the island" checked={settings?.islandEnabled ?? true} onChange={(e) => void update({ islandEnabled: e.target.checked })} />
          </Row>
          {settings?.islandEnabled !== false && (
            <>
              <Row label="When to show" hint="“While playing” hides it until a song is loaded.">
                <Seg label="When to show the island" value={settings?.islandMode ?? 'always'} options={[['always', 'Always'], ['playing', 'While playing']]} onChange={(v) => void update({ islandMode: v })} />
              </Row>
              <Row label="Size">
                <Seg label="Island size" value={settings?.islandSize ?? 'comfortable'} options={[['compact', 'Compact'], ['comfortable', 'Comfortable']]} onChange={(v) => void update({ islandSize: v })} />
              </Row>
              <Row label="Artwork"><input type="checkbox" role="switch" aria-label="Show artwork in the island" checked={settings?.islandArt ?? true} onChange={(e) => void update({ islandArt: e.target.checked })} /></Row>
              <Row label="Purity badge" hint="Shows how pure the playing song is.">
                <input type="checkbox" role="switch" aria-label="Show the purity badge in the island" checked={settings?.islandBadge ?? true} onChange={(e) => void update({ islandBadge: e.target.checked })} />
              </Row>
              {settings?.platform === 'win32' && (
                <Row label="Position" hint="Which screen edge the island sits on.">
                  <Seg label="Island position" value={settings.islandEdge} options={[['top', 'Top'], ['bottom', 'Bottom']]} onChange={(v) => void update({ islandEdge: v })} />
                </Row>
              )}
            </>
          )}
        </section>
        <section aria-labelledby="set-upd" style={{ marginTop: 32 }}>
          <h2 id="set-upd" className="t-label ink-2 set-h">Updates</h2>
          <Row label="Check for updates automatically" hint="Nothing is downloaded until you choose to.">
            <input type="checkbox" role="switch" aria-label="Check for updates automatically" disabled={upd.state === 'unavailable'} checked={settings?.updateChecks ?? true} onChange={(e) => void useStore.getState().updateSettings({ updateChecks: e.target.checked })} />
          </Row>
          <div className="set-row">
            <span role="status" aria-live="polite" style={{ color: upd.state === 'error' ? 'var(--warn)' : undefined }}>{describeUpdate(upd)}</span>
            <span style={{ display: 'flex', gap: 12 }}>
              {(upd.state === 'idle' || upd.state === 'none' || upd.state === 'error') && <button type="button" className="ghost-btn" onClick={() => bridge.updateAction('check')}>Check now</button>}
              {upd.state === 'available' && <button type="button" className="primary" onClick={() => bridge.updateAction('download')}>Download</button>}
              {upd.state === 'ready' && <button type="button" className="primary" onClick={() => bridge.updateAction('install')}>Restart to update</button>}
            </span>
          </div>
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
