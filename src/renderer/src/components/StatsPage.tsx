import { useEffect, useState } from 'react'
import type { StatsData } from '@shared/library'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function Bars({ values, labels, label }: { values: number[]; labels: string[]; label: string }): JSX.Element {
  const max = Math.max(1, ...values)
  return (
    <figure className="bars" aria-label={label}>
      <div className="bars-row">
        {values.map((v, i) => (
          <div key={i} className="bar-col" title={`${labels[i]}: ${v} ${v === 1 ? 'play' : 'plays'}`}>
            <span className="bar" style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: v === max && v > 0 ? 'var(--accent)' : 'var(--ink)' }} />
          </div>
        ))}
      </div>
      <div className="bars-row t-label ink-2" aria-hidden="true">{labels.map((l, i) => <span key={i} className="bar-lab">{l}</span>)}</div>
    </figure>
  )
}

const TIERS: Array<[keyof StatsData['purity'], string, string]> = [
  ['pure', 'Pure', 'var(--ok)'], ['good', 'Clean', 'var(--ink)'], ['limited', 'Limited', 'var(--warn)'], ['thin', 'Thin', 'var(--err)'], ['lossy', 'Lossy', 'var(--ink-2)'], ['unmeasured', 'Measuring', 'var(--rule)']
]

/** "Listening": your library and habits in numbers. Everything is computed on this computer. */
export function StatsPage(): JSX.Element {
  const [d, setD] = useState<StatsData | null>(null)
  const activity = useStore((s) => s.activityVersion)
  const version = useStore((s) => s.libraryVersion)
  const openList = useStore((s) => s.openList)
  useEffect(() => {
    let live = true
    void bridge.libraryCall<StatsData>({ op: 'stats' }).then((x) => live && setD(x)).catch(() => undefined)
    return () => { live = false }
  }, [activity, version])

  const total = d ? Object.values(d.purity).reduce((a, b) => a + b, 0) : 0
  return (
    <>
      <div className="titlebar-drag" style={{ height: 'var(--shell-titlebar)', flexShrink: 0 }} />
      <div className="page-head"><h1 className="t-display">Listening</h1></div>
      <div className="page-scroll">
        {!d ? <p className="ink-2" aria-busy="true">Counting…</p> : (
          <>
            <dl className="kpis">
              {[[d.songs.toLocaleString(), 'songs'], [d.albums.toLocaleString(), 'albums'], [d.artists.toLocaleString(), 'artists'], [`${d.hoursOfMusic}`, 'hours of music'], [d.plays.toLocaleString(), 'plays'], [`${d.hoursListened}`, 'hours listened']].map(([v, l]) => (
                <div key={l} className="kpi"><dt className="t-label ink-2">{l}</dt><dd className="t-readout" style={{ margin: 0 }}>{v}</dd></div>
              ))}
            </dl>

            <section className="shelf-sec" aria-labelledby="st-pur">
              <h2 id="st-pur" className="t-title">Purity of your library</h2>
              {total === 0 ? <p className="ink-2">Nothing to measure yet.</p> : (
                <>
                  <div className="stack" role="img" aria-label={TIERS.map(([k, l]) => `${l} ${d.purity[k]}`).join(', ')}>
                    {TIERS.map(([k, , c]) => d.purity[k] > 0 && <span key={k} style={{ flex: d.purity[k], background: c }} title={`${d.purity[k]} songs`} />)}
                  </div>
                  <ul className="legend">
                    {TIERS.map(([k, l, c]) => (
                      <li key={k}><i style={{ background: c }} />{l}<span className="ink-2"> {d.purity[k].toLocaleString()}</span></li>
                    ))}
                  </ul>
                  <p className="ink-2" style={{ fontSize: 13, margin: '8px 0 0' }}>Pure is 95 % or more of the frequency range holding real signal; Thin is under 50 %, typical of a CD upscaled to hi-res. {d.purity.thin + d.purity.limited > 0 && <button type="button" className="ghost-btn" style={{ padding: 0 }} onClick={() => openList('upscaled')}>Review suspicious songs</button>}</p>
                </>
              )}
            </section>

            {d.plays === 0 ? (
              <p className="ink-2" style={{ marginTop: 24 }}>Plays are counted after 30 seconds (or half the song). Listen for a while and your top artists, songs and listening hours appear here.</p>
            ) : (
              <>
                <div className="two-col">
                  <section aria-labelledby="st-ta"><h2 id="st-ta" className="t-title">Top artists</h2><ol className="rank">{d.topArtists.map((a) => <li key={a.name}><span className="ell" dir="auto">{a.name}</span><span className="t-label ink-2">{a.plays}×</span></li>)}</ol></section>
                  <section aria-labelledby="st-ts"><h2 id="st-ts" className="t-title">Top songs</h2><ol className="rank">{d.topSongs.map((a) => <li key={a.path}><span className="ell" dir="auto">{a.title}<span className="ink-2"> · {a.artist}</span></span><span className="t-label ink-2">{a.plays}×</span></li>)}</ol></section>
                  <section aria-labelledby="st-tl"><h2 id="st-tl" className="t-title">Top albums</h2><ol className="rank">{d.topAlbums.map((a) => <li key={a.title + a.artist}><span className="ell" dir="auto">{a.title}<span className="ink-2"> · {a.artist}</span></span><span className="t-label ink-2">{a.plays}×</span></li>)}</ol></section>
                </div>
                <div className="two-col" style={{ marginTop: 32 }}>
                  <section aria-labelledby="st-wd"><h2 id="st-wd" className="t-title">By weekday</h2><Bars values={d.byWeekday} labels={DAYS} label="Plays by weekday" /></section>
                  <section aria-labelledby="st-hr"><h2 id="st-hr" className="t-title">By hour</h2><Bars values={d.byHour} labels={d.byHour.map((_, i) => (i % 6 === 0 ? String(i) : ''))} label="Plays by hour of day" /></section>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
