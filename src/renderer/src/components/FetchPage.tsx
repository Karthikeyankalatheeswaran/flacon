import { useEffect, useRef, useState } from 'react'
import type { FetchJob, Quality } from '@shared/fetch'
import type { FetchSettings, SearchHit } from '@shared/fetchIpc'
import { bridge } from '@/lib/bridge'
import { tabKeys } from '@/lib/a11y'
import { useStore } from '@/store'

const PROVIDERS = [
  { id: 'archive', name: 'Internet Archive', placeholder: 'Search public-domain and Creative Commons albums', blurb: 'Public-domain and Creative Commons audio: FLAC where an item has it, MP3 or Ogg otherwise. Only items with a clear licence are listed.' },
  { id: 'commons', name: 'Wikimedia Commons', placeholder: 'Search free recordings (e.g. Bach, rain, brass band)', blurb: 'Free-licence recordings from Wikimedia Commons: classical, field recordings, public domain. Mostly Ogg Vorbis, with FLAC and WAV when uploaded.' },
  { id: 'jamendo', name: 'Jamendo', placeholder: 'Search Creative Commons music', blurb: 'Creative Commons music from artists who allow downloads. Needs your own free Jamendo client ID.' },
  { id: 'link', name: 'Paste link', placeholder: 'https://…/album.zip', blurb: 'A direct link to a FLAC or WAV file, or a ZIP of them, such as a purchase download. The link must work on its own: nothing is bypassed.' }
] as const
type PId = (typeof PROVIDERS)[number]['id']
const QUALITY: Array<{ id: Quality; label: string; hint: string }> = [
  { id: 'best', label: 'Best available', hint: 'Lossless where the source has it, otherwise the best lossy file.' },
  { id: 'lossless', label: 'Lossless only', hint: 'FLAC / WAV only. Sources without lossless files list nothing.' },
  { id: 'compact', label: 'Compact (MP3)', hint: 'Smaller MP3 or Ogg files, for phones and tight disks.' }
]
const QUALITY_KEY = 'flacon.fetch.quality'
const loadQuality = (): Quality => { try { const v = localStorage.getItem(QUALITY_KEY); return v === 'lossless' || v === 'compact' ? v : 'best' } catch { return 'best' } }

const mb = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`)
const STATUS: Record<FetchJob['status'], string> = { queued: 'Waiting', downloading: 'Downloading', verifying: 'Checking', importing: 'Adding to library', paused: 'Paused', done: 'In your library', failed: 'Failed', canceled: 'Canceled' }
const busy = (j: FetchJob): boolean => j.status === 'downloading' || j.status === 'verifying' || j.status === 'importing'

function JobRow({ j }: { j: FetchJob }): JSX.Element {
  const pct = j.total > 0 ? Math.min(100, (j.received / j.total) * 100) : 0
  const ctl = (op: 'pause' | 'resume' | 'cancel'): void => bridge.fetchControl({ op, id: j.id })
  return (
    <li className="job" aria-label={`${j.item.title}: ${STATUS[j.status]}`}>
      <div className="job-main">
        <span className="ell" dir="auto" style={{ fontWeight: 600 }}>{j.item.title}</span>
        <span className="t-label ink-2 ell" dir="auto">{[j.item.artist, j.item.album].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="job-status t-label" style={{ color: j.status === 'failed' ? 'var(--warn)' : 'var(--ink-2)' }}>
        <span>{STATUS[j.status]}{j.status === 'downloading' && j.total > 0 ? ` · ${mb(j.received)} of ${mb(j.total)}` : ''}</span>
        {(j.status === 'downloading' || j.status === 'queued' || j.status === 'paused') && (
          <div className="fill" style={{ width: '100%', margin: '6px 0 0', background: 'var(--rule)' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Download progress">
            <b style={{ width: `${pct}%`, background: 'var(--tint-ink)' }} /><i />
          </div>
        )}
        {j.error && <span style={{ color: 'var(--warn)' }} role={j.status === 'failed' ? 'alert' : undefined}>{j.error}</span>}
        {j.notes.map((n) => <span key={n} style={{ color: /Claims|Labelled|corrupt|damaged/.test(n) ? 'var(--warn)' : 'var(--ink-2)' }}>{n}</span>)}
        {j.item.license && <span title={j.item.license.attribution}>{j.item.license.name}</span>}
      </div>
      <div className="job-actions">
        {(busy(j) || j.status === 'queued') && j.status !== 'verifying' && j.status !== 'importing' && <button type="button" className="ghost-btn" onClick={() => ctl('pause')}>Pause</button>}
        {(j.status === 'paused' || j.status === 'failed' || j.status === 'canceled') && <button type="button" className="ghost-btn" onClick={() => ctl('resume')}>{j.status === 'paused' ? 'Resume' : 'Retry'}</button>}
        {j.status !== 'done' && j.status !== 'canceled' && <button type="button" className="ghost-btn" onClick={() => ctl('cancel')}>Cancel</button>}
      </div>
    </li>
  )
}

export function FetchPage(): JSX.Element {
  const jobs = useStore((s) => s.fetchJobs)
  const [prov, setProv] = useState<PId>('archive')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'results'; hits: SearchHit[] }>({ kind: 'idle' })
  const [adding, setAdding] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [settings, setSettings] = useState<FetchSettings>({ jamendoClientId: '', watchDownloads: false })
  const [quality, setQuality] = useState<Quality>(loadQuality)
  const token = useRef(0)
  const p = PROVIDERS.find((x) => x.id === prov)!

  useEffect(() => void bridge.fetchSettings().then(setSettings), [])

  const search = async (): Promise<void> => {
    if (!query.trim()) return
    const t = ++token.current
    setState({ kind: 'loading' })
    setNotice(null)
    const r = await bridge.fetchSearch({ provider: prov, query: query.trim(), quality })
    if (t !== token.current) return // a newer search superseded this one
    setState(r.ok ? { kind: 'results', hits: r.results } : { kind: 'error', message: r.error })
  }
  const add = async (h: SearchHit): Promise<void> => {
    setAdding(h.id)
    const r = await bridge.fetchEnqueue({ provider: h.provider, id: h.id, quality })
    setAdding(null)
    setNotice(r.ok ? { ok: true, text: `Added ${r.count} ${r.count === 1 ? 'file' : 'files'} to the queue.` } : { ok: false, text: r.error })
  }
  const save = (next: FetchSettings): void => {
    setSettings(next)
    void bridge.fetchSetSettings(next).then(setSettings)
  }

  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'failed' || j.status === 'canceled').length

  return (
    <>
      <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)' }} />
      <div className="page-head">
        <h1 className="t-display">Fetch</h1>
        <div role="tablist" className="tabs" onKeyDown={tabKeys}>
          {PROVIDERS.map((x) => (
            <button key={x.id} type="button" role="tab" className="tab" aria-selected={x.id === prov} onClick={() => { setProv(x.id); setState({ kind: 'idle' }); setNotice(null) }}>{x.name}</button>
          ))}
        </div>
      </div>
      <div className="fetch-body">
        <p className="ink-2" style={{ margin: '12px 0' }}>{p.blurb}</p>
        <form className="fetch-search" onSubmit={(e) => { e.preventDefault(); void search() }} role="search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={p.placeholder} aria-label={`Search ${p.name}`} spellCheck={false} />
          <button type="submit" className="primary" disabled={!query.trim() || state.kind === 'loading'}>{prov === 'link' ? 'Check link' : 'Search'}</button>
        </form>
        {prov !== 'link' && (
          <div className="quality" role="radiogroup" aria-label="Audio quality">
            <span className="t-label ink-2">Audio quality</span>
            <div className="seg">
              {QUALITY.map((q) => (
                <button key={q.id} type="button" role="radio" aria-checked={quality === q.id} title={q.hint}
                  onClick={() => { setQuality(q.id); setState({ kind: 'idle' }); try { localStorage.setItem(QUALITY_KEY, q.id) } catch { /* private window */ } }}>{q.label}</button>
              ))}
            </div>
            <span className="t-label ink-2">{QUALITY.find((q) => q.id === quality)!.hint}</span>
          </div>
        )}
        {prov === 'jamendo' && (
          <label className="t-label ink-2" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            Jamendo client ID
            <input className="fetch-id" value={settings.jamendoClientId} onChange={(e) => save({ ...settings, jamendoClientId: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} aria-label="Jamendo client ID" spellCheck={false} />
          </label>
        )}

        <div aria-live="polite">
          {notice && <p role={notice.ok ? 'status' : 'alert'} style={{ color: notice.ok ? 'var(--ink)' : 'var(--warn)', margin: '12px 0 0' }}>{notice.text}</p>}
          {state.kind === 'loading' && (
            <ul className="hits" aria-busy="true" aria-label="Searching">
              {[0, 1, 2].map((i) => <li key={i} className="hit"><span className="skel" style={{ width: `${60 - i * 10}%` }} /></li>)}
            </ul>
          )}
          {state.kind === 'error' && (
            <div className="empty" role="alert" style={{ height: 'auto', padding: '24px 0' }}>
              <h2 className="t-title">Couldn’t search</h2>
              <p className="ink-2">{state.message}</p>
              <button type="button" className="primary" onClick={() => void search()}>Try again</button>
            </div>
          )}
          {state.kind === 'results' && state.hits.length === 0 && (
            <div className="empty" role="status" style={{ height: 'auto', padding: '24px 0' }}>
              <h2 className="t-title">No licensed matches</h2>
              <p className="ink-2">Try fewer words, an artist name or a different audio quality. Items without a clear licence are never listed.</p>
            </div>
          )}
          {state.kind === 'results' && state.hits.length > 0 && (
            <ul className="hits" aria-label="Results">
              {state.hits.map((h) => (
                <li key={h.id} className="hit">
                  <div className="job-main">
                    <span className="ell" dir="auto" style={{ fontWeight: 600 }}>{h.title}</span>
                    <span className="t-label ink-2 ell" dir="auto">{h.artist}</span>
                  </div>
                  <span className="t-label ink-2" title={h.license?.attribution}>{h.license?.name}</span>
                  <button type="button" className="primary" disabled={adding === h.id} onClick={() => void add(h)}>{adding === h.id ? 'Adding…' : 'Fetch'}</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="meta t-label ink-2" style={{ marginTop: 24 }}>
          <span>Queue · {jobs.length}</span>
          {finished > 0 && <button type="button" className="ghost-btn" onClick={() => bridge.fetchControl({ op: 'clear' })}>Clear finished</button>}
          <label style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }} title="Copies purchase ZIPs that contain lossless audio from your Downloads folder into your library. Your original file stays where it is.">
            <input type="checkbox" checked={settings.watchDownloads} onChange={(e) => save({ ...settings, watchDownloads: e.target.checked })} />
            Watch Downloads folder
          </label>
        </div>
        {jobs.length === 0 ? (
          <div className="empty" role="status" style={{ height: 'auto', padding: '24px 0' }}>
            <h2 className="t-title">Nothing fetching</h2>
            <p className="ink-2">Everything is checked before it’s added: damaged lossless files are rejected, fake hi-res is flagged, and lossy files are labelled as lossy.</p>
          </div>
        ) : (
          <ul className="jobs" aria-label="Fetch queue">{jobs.map((j) => <JobRow key={j.id} j={j} />)}</ul>
        )}
      </div>
    </>
  )
}
