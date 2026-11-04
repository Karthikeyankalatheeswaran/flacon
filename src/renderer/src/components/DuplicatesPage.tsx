import { useEffect, useMemo, useState } from 'react'
import type { DuplicateGroup } from '@shared/duplicates'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'
import { Icon } from './icons'

const fmtSize = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`)
const spec = (m: DuplicateGroup['members'][number]): string => `${m.codec.toUpperCase()} · ${m.bitDepth ? `${m.bitDepth}-bit ` : ''}${(m.sampleRate / 1000).toFixed(m.sampleRate % 1000 ? 1 : 0)} kHz`
const folderOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '').split(/[\\/]/).slice(-2).join(' / ')

/** "Duplicates": the same recording stored more than once. Extra copies can be moved to the Trash; one always stays. */
export function DuplicatesPage(): JSX.Element {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const version = useStore((s) => s.libraryVersion)
  const show = useStore((s) => s.showToast)

  useEffect(() => {
    let live = true
    void bridge.libraryCall<DuplicateGroup[]>({ op: 'duplicates' }).then((g) => {
      if (!live) return
      setGroups(g)
      setPicked((prev) => new Set([...prev].filter((p) => g.some((x) => x.members.some((m) => m.path === p)))))
    }).catch(() => live && setGroups([]))
    return () => { live = false }
  }, [version])

  const extras = useMemo(() => (groups ?? []).flatMap((g) => g.members.slice(1).map((m) => m.path)), [groups])
  const reclaim = useMemo(() => (groups ?? []).reduce((n, g) => n + g.members.slice(1).filter((m) => picked.has(m.path)).reduce((a, m) => a + m.size, 0), 0), [groups, picked])
  const toggle = (p: string): void => setPicked((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const trash = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await bridge.trashDuplicates([...picked])
      if (r.message) show(r.message)
      if (r.trashed) setPicked(new Set())
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', flexShrink: 0 }} />
      <div className="page-head">
        <h1 className="t-display">Duplicates</h1>
        {groups && groups.length > 0 && (
          <div className="dup-actions">
            <button type="button" className="ghost-btn" onClick={() => setPicked(new Set(extras))}>Select all extras</button>
            <button type="button" className="ghost-btn" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>Clear</button>
            <button type="button" className="primary" style={{ marginTop: 0 }} disabled={picked.size === 0 || busy} onClick={() => void trash()}><Icon name="trash" size={16} /> Move {picked.size || ''} to Trash</button>
          </div>
        )}
      </div>
      <div className="page-scroll">
        {!groups ? <p className="ink-2" aria-busy="true">Looking for copies…</p> : groups.length === 0 ? (
          <p className="ink-2">No duplicates. Every song in your library appears once.</p>
        ) : (
          <>
            <p className="ink-2 dup-lede">{groups.length} {groups.length === 1 ? 'song is' : 'songs are'} stored more than once. The best copy of each is marked <b>Keep</b>.{picked.size > 0 && ` Moving the ticked files frees ${fmtSize(reclaim)}.`}</p>
            <ul className="dup-list" aria-label="Duplicate songs">
              {groups.map((g) => (
                <li key={`${g.artist}|${g.title}|${g.members[0]!.path}`} className="dup-group">
                  <div className="dup-title"><span className="t-body" style={{ fontWeight: 600 }}>{g.title}</span><span className="ink-2"> · {g.artist || 'Unknown artist'}</span></div>
                  <ul className="dup-members">
                    {g.members.map((m, i) => (
                      <li key={m.path} className="dup-member">
                        {i === 0 ? <span className="dup-keep t-label">Keep</span> : (
                          <input type="checkbox" aria-label={`Move ${m.path} to the Trash`} checked={picked.has(m.path)} onChange={() => toggle(m.path)} />
                        )}
                        <span className="dup-where ell" title={m.path}>{m.album || 'Unknown album'}<span className="ink-2"> — {folderOf(m.path)}</span></span>
                        <span className="dup-spec t-label ink-2">{spec(m)}{m.lossless ? '' : ' · lossy'}{m.dr ? ` · DR ${m.dr}` : ''}</span>
                        <span className="dup-size t-label ink-2">{fmtSize(m.size)}</span>
                        <button type="button" className="ghost-btn" aria-label={`Show ${m.title} in the file manager`} onClick={() => bridge.reveal(m.path)}><Icon name="reveal" size={16} /></button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}
