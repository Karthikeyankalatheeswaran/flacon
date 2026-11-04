import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { durationLabel, timecode } from '@shared/library'
import { useStore } from '@/store'
import { Icon } from './icons'
import { PurityMeter } from './Purity'

const ROW = 52

/** Up next: the real play queue. Click to jump, drag to reorder, × to remove. Shuffle shows the order it will play. */
export function QueuePanel(): JSX.Element {
  const queue = useStore((s) => s.queue)
  const index = useStore((s) => s.pb.queueIndex)
  const history = useStore((s) => s.pb.queueHistory)
  const [showHistory, setShowHistory] = useState(false)
  const status = useStore((s) => s.pb.status)
  const send = useStore((s) => s.send)
  const ref = useRef<HTMLDivElement>(null)
  const [from, setFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const items = queue.items
  const virt = useVirtualizer({ count: items.length, getScrollElement: () => ref.current, estimateSize: () => ROW, overscan: 6 })

  // Keep the playing row in view when the track changes.
  useEffect(() => {
    if (items.length && index < items.length) virt.scrollToIndex(index, { align: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, queue.rev])

  const upcoming = items.slice(index + 1).reduce((s, i) => s + i.durationSec, 0)
  if (!items.length) return <div className="panel-empty"><p className="t-label dim">The queue is empty. Right-click a song and choose Add to queue, or drag an album onto this panel.</p></div>

  return (
    <div className="queue">
      <div className="queue-head t-label dim">
        <span>{items.length - index - 1 > 0 ? `${items.length - index - 1} up next · ${durationLabel(Math.round(upcoming / 60))}` : 'Last song in the queue'}</span>
        <span className="queue-tools">
          {history.length > 0 && <button type="button" className="ghost-btn" style={{ padding: 0 }} aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}><Icon name="clock" size={14} /> History</button>}
          {history.length > 0 && <button type="button" className="ghost-btn" style={{ padding: 0 }} onClick={() => send({ type: 'queueRestore', slot: history.length - 1 })} title={history[history.length - 1]!.why}><Icon name="arrow-counter-clockwise" size={14} /> Undo</button>}
          <button type="button" className="ghost-btn" style={{ padding: 0 }} onClick={() => send({ type: 'clear' })} disabled={items.length <= index + 1}>Clear</button>
        </span>
      </div>
      {showHistory && history.length > 0 && (
        <ul className="queue-history" aria-label="Earlier queues">
          {history.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => (
            <li key={`${h.at}-${i}`}>
              <button type="button" className="qh-btn" onClick={() => { send({ type: 'queueRestore', slot: i }); setShowHistory(false) }}>
                <span className="ell">{h.why}</span>
                <span className="t-label dim">{h.count} {h.count === 1 ? 'song' : 'songs'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="queue-scroll" ref={ref}>
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const it = items[v.index]!
            const now = v.index === index
            return (
              <div key={`${v.index}-${it.path}`} className={`qrow${now ? ' now' : ''}${over === v.index ? ' drop' : ''}`} style={{ transform: `translateY(${v.start}px)`, height: ROW }}
                draggable
                onDragStart={(e) => { setFrom(v.index); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => { if (from !== null) { e.preventDefault(); setOver(v.index) } }}
                onDragLeave={() => setOver((o) => (o === v.index ? null : o))}
                onDrop={(e) => { e.preventDefault(); if (from !== null && from !== v.index) send({ type: 'move', from, to: v.index }); setFrom(null); setOver(null) }}
                onDragEnd={() => { setFrom(null); setOver(null) }}>
                <button type="button" className="qmain" onClick={() => send({ type: 'jump', index: v.index })} aria-label={`Play ${it.title}`} aria-current={now ? 'true' : undefined}>
                  <i className="qth" style={{ background: it.artUrl ? `url("${it.artUrl}") center/cover` : 'color-mix(in srgb, var(--v-ink) 14%, transparent)' }}>{now && <span className="qnow"><Icon name={status === 'playing' ? 'waveform' : 'pause'} size={16} /></span>}</i>
                  <span className="qtext">
                    <span className="ell" dir="auto" style={{ fontWeight: now ? 650 : 500 }}>{it.title}</span>
                    <span className="ell t-label dim" dir="auto">{it.artist || '—'}</span>
                  </span>
                </button>
                <span className="qmeta t-label dim"><PurityMeter f={it} width={28} label={false} />{it.durationSec ? timecode(it.durationSec) : ''}</span>
                <button type="button" className="qx" aria-label={`Remove ${it.title} from the queue`} onClick={() => send({ type: 'remove', index: v.index })}><Icon name="close" size={14} /></button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
