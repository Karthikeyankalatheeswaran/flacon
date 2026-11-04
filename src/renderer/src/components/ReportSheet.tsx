import { useEffect, useRef, useState } from 'react'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'

/** "Report a problem": say what happened, read exactly what would be shared, then copy or save it. Nothing leaves the computer. */
export function ReportSheet(): JSX.Element | null {
  const open = useStore((s) => s.reportOpen)
  const setOpen = useStore((s) => s.setReportOpen)
  const show = useStore((s) => s.showToast)
  const [note, setNote] = useState('')
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const t = window.setTimeout(() => field.current?.focus(), 0)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [open, setOpen])
  // Refresh the preview as the note changes (debounced; main redacts it).
  useEffect(() => {
    if (!open) return undefined
    let live = true
    const t = window.setTimeout(() => void bridge.report({ op: 'get', note }).then((r) => live && setText(r.text)), 150)
    return () => { live = false; window.clearTimeout(t) }
  }, [open, note])
  if (!open) return null

  const act = async (op: 'copy' | 'save'): Promise<void> => {
    const r = await bridge.report({ op, note })
    if (r.message && r.message !== 'Cancelled.') show(r.message)
    if (r.ok) setOpen(false)
  }
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="report-title" className="sheet-card report-card" style={{ padding: 28 }}>
        <h2 id="report-title" className="t-title" style={{ margin: '0 0 6px' }}>Report a problem</h2>
        <p className="ink-2" style={{ margin: '0 0 14px' }}>Tell us what went wrong. This is the whole report; your name, e-mail and folder names are removed. Nothing is sent: copy it or save it, then share it yourself.</p>
        <label className="t-label ink-2" htmlFor="report-note">What happened?</label>
        <textarea id="report-note" ref={field} className="report-note" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: the song stops after a few seconds when I plug in my DAC." />
        <label className="t-label ink-2" htmlFor="report-text" style={{ marginTop: 14, display: 'block' }}>Report contents</label>
        <textarea id="report-text" className="report-text" readOnly rows={9} value={text} spellCheck={false} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, marginTop: 16, alignItems: 'center' }}>
          <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="ghost-btn" onClick={() => void act('save')}>Save as file…</button>
          <button type="button" className="primary" style={{ marginTop: 0 }} onClick={() => void act('copy')}>Copy report</button>
        </div>
      </section>
    </div>
  )
}
