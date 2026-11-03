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
  const lineRefs = useRef<Array<HTMLButtonElement | HTMLParagraphElement | null>>([])

  useEffect(() => {
    setLyrics(undefined)
    if (!path) return undefined
    let live = true
    void bridge.libraryCall<Lyrics | null>({ op: 'lyrics', path }).then((l) => live && setLyrics(l)).catch(() => live && setLyrics(null))
    return () => { live = false }
  }, [path])

  const active = lyrics?.synced ? activeLine(lyrics.lines, pos) : -1
  useEffect(() => {
    if (active >= 0) lineRefs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  if (!path) return <div className="panel-empty"><p className="t-label dim">Play something to see its lyrics.</p></div>
  if (lyrics === undefined) return <div className="panel-empty" aria-busy="true"><p className="t-label dim">Looking for lyrics…</p></div>
  if (!lyrics) return <div className="panel-empty"><p className="t-label dim">No lyrics for this song. Put a .lrc file with the same name beside it, or embed lyrics in the tags.</p></div>
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
      <p className="t-label dim" style={{ marginTop: 16 }}>{lyrics.source === 'sidecar' ? 'From a .lrc file' : 'From the song’s tags'}</p>
    </div>
  )
}
