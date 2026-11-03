import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fillPercent, songQualityLabel, timecode, type LibrarySong, type SongSort } from '@shared/library'
import { applyClick, emptySelection, moveFocus, type Selection } from '@shared/selection'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'

const ROW_H = 48
const PAGE = 200
const COLS_KEY = 'flacon.songs.cols'
const MIN_COL = 96

type Dir = 'asc' | 'desc'
const COLUMNS: Array<{ key: SongSort | 'n'; label: string; sortable: boolean; align?: 'end' }> = [
  { key: 'n', label: '#', sortable: false, align: 'end' },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true },
  { key: 'album', label: 'Album', sortable: true },
  { key: 'duration', label: 'Time', sortable: true, align: 'end' },
  { key: 'quality', label: 'Quality', sortable: true }
]

function loadWidths(): [number, number, number] {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as number[] | null
    if (v && v.length === 3 && v.every((n) => Number.isFinite(n) && n >= MIN_COL)) return v as [number, number, number]
  } catch {
    /* storage blocked: defaults */
  }
  return [300, 200, 200]
}

export function SongsTable({ text }: { text: string }): JSX.Element {
  const send = useStore((s) => s.send)
  const libraryVersion = useStore((s) => s.libraryVersion)
  const [sort, setSort] = useState<SongSort>('title')
  const [dir, setDir] = useState<Dir>('asc')
  const [total, setTotal] = useState<number | null>(null)
  const [pages, setPages] = useState<Map<number, LibrarySong[]>>(new Map())
  const [sel, setSel] = useState<Selection>(emptySelection)
  const [focus, setFocus] = useState(0)
  const [widths, setWidths] = useState<[number, number, number]>(loadWidths)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inflight = useRef(new Set<number>())
  const generation = useRef(0) // bumped on sort/filter/library change so late pages are dropped

  // Reset when the query changes. Selection indices would point at different songs after a re-sort.
  useEffect(() => {
    generation.current++
    inflight.current.clear()
    setPages(new Map())
    setSel(emptySelection)
    setFocus(0)
    setTotal(null)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [sort, dir, text])

  // Library changed under us (scan/watch): refetch in place, keep scroll and selection.
  useEffect(() => {
    generation.current++
    inflight.current.clear()
    setPages(new Map())
  }, [libraryVersion])

  const fetchPage = useCallback(
    (page: number) => {
      if (inflight.current.has(page)) return
      inflight.current.add(page)
      const gen = generation.current
      void bridge.librarySongs({ sort, dir, text, offset: page * PAGE, limit: PAGE }).then((r) => {
        if (gen !== generation.current) return
        inflight.current.delete(page)
        setTotal(r.total)
        setPages((p) => new Map(p).set(page, r.rows))
      }).catch(() => inflight.current.delete(page))
    },
    [sort, dir, text]
  )

  const count = total ?? 0
  const virt = useVirtualizer({ count, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 8 })
  const items = virt.getVirtualItems()

  // Fetch whichever pages the visible window touches (plus the first page, which reveals the total).
  const first = items[0]?.index ?? 0
  const last = items[items.length - 1]?.index ?? 0
  useEffect(() => {
    const need = new Set([Math.floor(first / PAGE), Math.floor(last / PAGE)])
    if (total === null) need.add(0)
    need.forEach((p) => !pages.has(p) && fetchPage(p))
  }, [first, last, pages, total, fetchPage])

  const rowAt = (i: number): LibrarySong | undefined => pages.get(Math.floor(i / PAGE))?.[i % PAGE]

  // Play from a row: queue the following loaded rows, so "double-click a song" keeps playing the list.
  const playFrom = (i: number): void => {
    const tracks: Array<{ path: string }> = []
    for (let k = i; k < Math.min(count, i + PAGE); k++) {
      const r = rowAt(k)
      if (!r) break
      if (!r.offline) tracks.push({ path: r.path })
    }
    if (tracks.length) send({ type: 'load', tracks, index: 0 })
  }
  const playSelection = (): void => {
    const idx = [...sel.indices].sort((a, b) => a - b)
    if (idx.length <= 1) return playFrom(idx[0] ?? focus)
    const tracks = idx.map(rowAt).filter((r): r is LibrarySong => !!r && !r.offline).map((r) => ({ path: r.path }))
    if (tracks.length) send({ type: 'load', tracks, index: 0 })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const r = moveFocus(sel, focus, e.key === 'ArrowDown' ? 1 : -1, count, e.shiftKey)
      setFocus(r.focus)
      setSel(r.selection)
      virt.scrollToIndex(r.focus, { align: 'auto' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      playSelection()
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSel({ anchor: 0, indices: new Set(Array.from({ length: count }, (_, i) => i)) })
    }
  }

  const grid = useMemo(() => `40px minmax(${MIN_COL}px, ${widths[0]}fr) minmax(${MIN_COL}px, ${widths[1]}fr) minmax(${MIN_COL}px, ${widths[2]}fr) 64px 168px`, [widths])

  const toggleSort = (key: SongSort): void => {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setDir(key === 'duration' || key === 'quality' || key === 'added' ? 'desc' : 'asc')
    }
  }

  // Column resize: drag the handle on a header's right edge; widths persist.
  const startResize = (col: 0 | 1 | 2) => (e: React.PointerEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const start = widths[col]
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => setWidths((w) => { const n = [...w] as [number, number, number]; n[col] = Math.max(MIN_COL, Math.round(start + ev.clientX - startX)); return n })
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setWidths((w) => { try { localStorage.setItem(COLS_KEY, JSON.stringify(w)) } catch { /* ignore */ } return w })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  useLayoutEffect(() => virt.measure(), [virt, count])

  const selected = sel.indices.size
  return (
    <>
      <div className="meta t-label ink-2">
        {selected > 0 ? (
          <>
            <span style={{ color: 'var(--ink)' }}>{selected.toLocaleString()} selected</span>
            <span>Press Enter to play</span>
          </>
        ) : (
          <span>{total === null ? 'Loading songs…' : `${total.toLocaleString()} songs`}</span>
        )}
        <span style={{ marginLeft: 'auto' }}>Shift-click range · Ctrl-click add</span>
      </div>
      <div role="table" aria-label="Songs" aria-multiselectable="true" aria-rowcount={count + 1} className="songs" onKeyDown={onKeyDown} tabIndex={0}>
        <div role="row" className="srow shead t-label" style={{ gridTemplateColumns: grid }}>
          {COLUMNS.map((c, i) => (
            <div key={c.key} role="columnheader" className="hcell" style={{ justifyContent: c.align === 'end' ? 'flex-end' : undefined }}
              aria-sort={c.key === sort ? (dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}>
              {c.sortable ? (
                <button type="button" className="hbtn" onClick={() => toggleSort(c.key as SongSort)} style={{ color: c.key === sort ? 'var(--ink)' : undefined }}>
                  {c.label}{c.key === sort ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              ) : c.label}
              {i >= 1 && i <= 3 && <span className="grip" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label} column`} onPointerDown={startResize((i - 1) as 0 | 1 | 2)} />}
            </div>
          ))}
        </div>
        <div className="sbody" ref={scrollRef} aria-busy={total === null}>
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {total !== null && count === 0 && (
              <div className="empty" role="status" style={{ position: 'absolute', inset: 0, height: 'auto' }}>
                <h2 className="t-title">{text.trim() ? `Nothing matches “${text}”` : 'No songs yet'}</h2>
                <p className="ink-2">{text.trim() ? 'Accents and case don’t matter. Try an artist or album name.' : 'Add a music folder from the Albums tab and songs appear here as they are found.'}</p>
              </div>
            )}
            {items.map((it) => {
              const s = rowAt(it.index)
              const isSel = sel.indices.has(it.index)
              const pos = { transform: `translateY(${it.start}px)`, gridTemplateColumns: grid }
              if (!s) {
                // Skeleton exactly as tall as a real row: no layout shift while a page loads.
                return (
                  <div key={it.key} role="row" aria-rowindex={it.index + 2} className="srow" style={pos}>
                    <span className="t-label ink-2" style={{ textAlign: 'right' }}>{it.index + 1}</span>
                    <span className="skel" style={{ width: '60%' }} /><span className="skel" style={{ width: '40%' }} /><span className="skel" style={{ width: '40%' }} /><span /><span />
                  </div>
                )
              }
              const up = s.quality === 'upscaled'
              return (
                <div key={it.key} role="row" aria-rowindex={it.index + 2} aria-selected={isSel} className={`srow${isSel ? ' sel' : ''}${it.index === focus ? ' foc' : ''}`}
                  style={{ ...pos, opacity: s.offline ? 0.4 : 1 }}
                  onClick={(e) => { setFocus(it.index); setSel((p) => applyClick(p, it.index, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })) }}
                  onDoubleClick={() => !s.offline && playFrom(it.index)}>
                  <span className="t-label ink-2" style={{ textAlign: 'right' }}>{it.index + 1}</span>
                  <span className="cell" role="cell" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <i className="thumb" style={{ background: s.sleeve }} />
                    <span className="ell" dir="auto">{s.title}</span>
                    {s.duplicate && <span className="t-label ink-2" title="Another copy of this song is in your library">duplicate</span>}
                  </span>
                  <span className="cell ink-2 ell" role="cell" dir="auto">{s.artist}</span>
                  <span className="cell ink-2 ell" role="cell" dir="auto">{s.album}</span>
                  <span className="cell t-label ink-2" role="cell" style={{ textAlign: 'right', fontSize: 13 }}>{timecode(s.durationSec)}</span>
                  <span className="cell" role="cell" style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span className="fill" style={{ width: 64, flexShrink: 0, margin: 0, background: up ? 'repeating-linear-gradient(90deg,var(--warn) 0 1px,transparent 1px 4px)' : 'var(--rule)' }}>
                      <b style={{ width: `${fillPercent(s)}%`, background: s.quality === 'hires' ? 'var(--tint-ink)' : s.quality === 'lossy' ? 'var(--ink-2)' : 'var(--ink)' }} /><i />
                    </span>
                    <span className="t-label ell" style={{ color: up ? 'var(--warn)' : 'var(--ink-2)' }}>{songQualityLabel(s)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
