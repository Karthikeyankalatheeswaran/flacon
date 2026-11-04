import { useEffect, useRef, useState } from 'react'
import { activeLine } from '@shared/lyrics'
import type { Lyrics } from '@shared/library'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'

/** Synced (.lrc / embedded) or plain lyrics. The sung line stays centred; click a line to jump there. */
export function LyricsPanel(): JSX.Element {
  const path = useStore((s) => s.pb.track?.path)
  const pos = useStore((s) => s.pb.positionSec)
  const send = useStore((s) => s.send)
  const [lyrics, setLyrics] = useState<Lyrics | null | undefined>(undefined)
  const online = useStore((s) => s.settings?.lyricsOnline ?? false)
  const update = useStore((s) => s.updateSettings)
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'none' | 'instrumental' | 'error'>('idle')
  const [tick, setTick] = useState(0)
  const lineRefs = useRef<Array<HTMLButtonElement | HTMLParagraphElement | null>>([])

  useEffect(() => {
    setLyrics(undefined)
    setLookup('idle')
    if (!path) return undefined
    let live = true
    void (async () => {
      let l = await bridge.libraryCall<Lyrics | null>({ op: 'lyrics', path }).catch(() => null)
      if (!l && online && live) {
        setLookup('busy')
        const r = await bridge.libraryCall<{ status: string }>({ op: 'lyricsOnline', path }).catch(() => ({ status: 'error' }))
        if (r.status === 'found') l = await bridge.libraryCall<Lyrics | null>({ op: 'lyrics', path }).catch(() => null)
        if (live) setLookup(l ? 'idle' : r.status === 'instrumental' ? 'instrumental' : r.status === 'none' ? 'none' : r.status === 'found' ? 'none' : 'error')
      }
      if (live) setLyrics(l)
    })()
    return () => { live = false }
  }, [path, online, tick])

  const active = lyrics?.synced ? activeLine(lyrics.lines, pos) : -1
  useEffect(() => {
    if (active >= 0) lineRefs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  if (!path) return <div className="panel-empty"><p className="t-label dim">Play something to see its lyrics.</p></div>
  if (lyrics === undefined) return <div className="panel-empty" aria-busy="true"><p className="t-label dim">Looking for lyrics…</p></div>
  if (!lyrics) {
    return (
      <div className="panel-empty">
        <p className="t-label dim">
          {lookup === 'instrumental' ? 'This one is instrumental.' : lookup === 'none' ? 'No lyrics found online for this song.' : lookup === 'error' ? 'Couldn’t reach the lyrics service. Try again later.' : 'No lyrics for this song. Put a .lrc file with the same name beside it, or embed lyrics in the tags.'}
        </p>
        {online ? (
          lookup !== 'instrumental' && <button type="button" className="ghost-btn" onClick={() => setTick((t) => t + 1)}>Search again</button>
        ) : (
          <>
            <button type="button" className="ghost-btn" onClick={() => void update({ lyricsOnline: true })}>Find lyrics online</button>
            <p className="t-label dim" style={{ maxWidth: 260 }}>Looks the song up on LRCLIB, a free lyrics database. Only its artist, title, album and length are sent. Found lyrics are saved on this computer.</p>
          </>
        )}
      </div>
    )
  }
  return (
    <div className="lyrics" aria-label="Lyrics">
      {lyrics.lines.map((l, i) =>
        lyrics.synced ? (
          <button key={i} type="button" ref={(el) => { lineRefs.current[i] = el }} className={`lyric${i === active ? ' active' : i < active ? ' past' : ''}`} dir="auto"
            onClick={() => l.t !== null && send({ type: 'seek', seconds: l.t })}>{l.text || '♪'}</button>
        ) : (
          <p key={i} ref={(el) => { lineRefs.current[i] = el }} className="lyric plain" dir="auto">{l.text || ' '}</p>
        )
      )}
      <p className="t-label dim" style={{ marginTop: 16 }}>{lyrics.source === 'sidecar' ? 'From a .lrc file' : lyrics.source === 'online' ? 'From LRCLIB' : 'From the song’s tags'}</p>
    </div>
  )
}
