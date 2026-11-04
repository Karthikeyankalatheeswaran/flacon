import { useEffect, useState } from 'react'
import { SHORTCUTS, acceleratorFromEvent, conflictWith, effective, isReserved, prettyAccelerator, type ShortcutDef } from '@shared/shortcuts'
import { useStore } from '@/store'

/** Settings ▸ Keyboard: click a shortcut, press the new keys. Esc cancels; conflicts and reserved keys are refused. */
export function ShortcutsEditor(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const mac = (useStore((s) => s.app?.platform) ?? 'darwin') !== 'win32'
  const [rec, setRec] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const overrides = settings?.shortcuts ?? {}
  const eff = effective(overrides)
  const label = (id: string): string => SHORTCUTS.find((s) => s.id === id)?.label ?? id

  useEffect(() => {
    if (!rec) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setRec(null); setNote(null); return }
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return // wait for the real key
      e.preventDefault()
      e.stopPropagation()
      const acc = acceleratorFromEvent(e, mac)
      if (!acc) { setNote('Use a modifier (⌘/Ctrl or ⌥/Alt) with a letter, number, arrow or F-key.'); return }
      if (isReserved(acc)) { setNote(`${prettyAccelerator(acc, mac)} is used by the system menu.`); return }
      const clash = conflictWith(rec, acc, overrides)
      if (clash) { setNote(`${prettyAccelerator(acc, mac)} is already used by “${label(clash)}”.`); return }
      const def = SHORTCUTS.find((s) => s.id === rec)
      const next = { ...overrides }
      if (def && effective({})[def.id] === acc) delete next[rec]
      else next[rec] = acc
      void update({ shortcuts: next })
      setRec(null)
      setNote(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, overrides, mac])

  const groups: ShortcutDef['group'][] = ['Playback', 'View', 'Go']
  return (
    <>
      {groups.map((g) => (
        <div key={g} role="group" aria-label={`${g} shortcuts`}>
          <h3 className="t-label ink-2 set-sub">{g}</h3>
          {SHORTCUTS.filter((s) => s.group === g).map((s) => {
            const custom = overrides[s.id] !== undefined
            const recording = rec === s.id
            return (
              <div key={s.id} className="set-row">
                <span>{s.label}</span>
                <span className="kb-cell">
                  {custom && !recording && <button type="button" className="ghost-btn" aria-label={`Reset ${s.label} to ${prettyAccelerator(effective({})[s.id]!, mac)}`} onClick={() => { const n = { ...overrides }; delete n[s.id]; void update({ shortcuts: n }) }}>Reset</button>}
                  <button type="button" className={`kb-key${recording ? ' rec' : ''}`} aria-label={`${s.label} shortcut: ${prettyAccelerator(eff[s.id]!, mac)}. Click to change.`} onClick={() => { setRec(recording ? null : s.id); setNote(null) }}>
                    {recording ? 'Press keys…' : prettyAccelerator(eff[s.id]!, mac)}
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      ))}
      <p className="t-label kb-note" role="status" aria-live="polite" style={{ color: note ? 'var(--warn)' : undefined }}>{note ?? (rec ? 'Press the new shortcut, or Esc to cancel.' : ' ')}</p>
      {Object.keys(overrides).length > 0 && <button type="button" className="ghost-btn" onClick={() => void update({ shortcuts: {} })}>Reset all shortcuts</button>}
    </>
  )
}
