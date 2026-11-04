import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { loudnessTitle, songQualityLabel, timecode, type LibrarySong, type SongSort } from '@shared/library'
import { applyClick, emptySelection, moveFocus, type Selection } from '@shared/selection'
import { bridge } from '@/lib/bridge'
import { useStore } from '@/store'
import { songMenu } from '@/lib/songActions'
import { Icon } from './icons'
import { PurityMeter } from './Purity'

const ROW_H = 48
const PAGE = 200
const COLS_KEY = 'flacon.songs.cols'
const MIN_COL = 96

type Dir = 'asc' | 'desc'
const COLUMNS: Array<{ key: SongSort | 'n' | 'fav'; label: string; sortable: boolean; align?: 'end' }> = [
  { key: 'n', label: '#', sortable: false, align: 'end' },
  { key: 'fav', label: '', sortable: false },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true },
  { key: 'album', label: 'Album', sortable: true },
  { key: 'plays', label: 'Plays', sortable: true, align: 'end' },
  { key: 'duration', label: 'Time', sortable: true, align: 'end' },
  { key: 'dr', label: 'Loudness', sortable: true, align: 'end' },
  { key: 'purity', label: 'Purity', sortable: true }
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

interface Props {
  text: string
  /** 'all', a smart id or 'playlist:<id>'. */
  scope?: string
  initialSort?: SongSort
  initialDir?: Dir
  playlistId?: number
}

const EMPTY: Record<string, [string, string]> = {
  favorites: ['No favourites yet', 'Press the heart on any song and it lands here.'],
  recent: ['Nothing played yet', 'Songs you listen to show up here, newest first.'],
  played: ['No plays counted yet', 'A play counts after 30 seconds, or half the song.'],
  verified: ['Nothing verified yet', 'Flacon is measuring your lossless songs in the background. Verified means 95 % or more of the frequency range is real.'],
  upscaled: ['Nothing to review', 'No song looks upscaled or padded. Good.'],
  month: ['Nothing new this month', 'Songs added in the last 30 days appear here.']
}

export function SongsTable({ text, scope = 'all', initialSort = 'title', initialDir = 'asc', playlistId }: Props): JSX.Element {
  const send = useStore((s) => s.send)
  const libraryVersion = useStore((s) => s.libraryVersion)
  const activityVersion = useStore((s) => s.activityVersion)
  const nowPath = useStore((s) => s.pb.track?.path)
  const openMenu = useStore((s) => s.openMenu)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const dragFrom = useRef<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [sort, setSort] = useState<SongSort>(initialSort)
  const [dir, setDir] = useState<Dir>(initialDir)
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
  }, [sort, dir, text, scope])

  // Library changed under us (scan/watch): refetch in place, keep scroll and selection.
  useEffect(() => {
    generation.current++
    inflight.current.clear()
    setPages(new Map())
  }, [libraryVersion, activityVersion])

  const fetchPage = useCallback(
    (page: number) => {
      if (inflight.current.has(page)) return
      inflight.current.add(page)
      const gen = generation.current
      void bridge.librarySongs({ sort, dir, text, scope, offset: page * PAGE, limit: PAGE }).then((r) => {
        if (gen !== generation.current) return
        inflight.current.delete(page)
        setTotal(r.total)
        setPages((p) => new Map(p).set(page, r.rows))
      }).catch(() => inflight.current.delete(page))
    },
    [sort, dir, text, scope]
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && playlistId) {
      e.preventDefault()
      const positions = [...sel.indices].map((i) => rowAt(i)?.pos).filter((p): p is number => p !== undefined)
      if (positions.length) void bridge.libraryCall({ op: 'playlistRemove', id: playlistId, positions })
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSel({ anchor: 0, indices: new Set(Array.from({ length: count }, (_, i) => i)) })
    }
  }

  const grid = useMemo(() => `36px 28px minmax(${MIN_COL}px, ${widths[0]}fr) minmax(${MIN_COL}px, ${widths[1]}fr) minmax(${MIN_COL}px, ${widths[2]}fr) 48px 56px 96px 148px`, [widths])

  const toggleSort = (key: SongSort): void => {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setDir(key === 'duration' || key === 'quality' || key === 'added' || key === 'purity' || key === 'dr' || key === 'plays' || key === 'lastPlayed' ? 'desc' : 'asc')
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
        <span style={{ marginLeft: 'auto' }}>Right-click for more · Shift-click range · {playlistId ? 'Drag to reorder · ' : ''}Enter plays</span>
      </div>
      <div role="grid" aria-label="Songs" aria-multiselectable="true" aria-rowcount={count + 1} className="songs" onKeyDown={onKeyDown} tabIndex={0}>
        <div role="row" className="srow shead t-label" style={{ gridTemplateColumns: grid }}>
          {COLUMNS.map((c, i) => (
            <div key={c.key} role="columnheader" className="hcell" style={{ justifyContent: c.align === 'end' ? 'flex-end' : undefined }}
              aria-sort={c.key === sort ? (dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}>
              {c.sortable ? (
                <button type="button" className="hbtn" onClick={() => toggleSort(c.key as SongSort)} style={{ color: c.key === sort ? 'var(--ink)' : undefined }}>
                  {c.label}{c.key === sort ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              ) : c.label}
              {i >= 2 && i <= 4 && <span className="grip" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label} column`} onPointerDown={startResize((i - 2) as 0 | 1 | 2)} />}
            </div>
          ))}
        </div>
        <div className="sbody" ref={scrollRef} aria-busy={total === null} role="rowgroup">
          <div role="presentation" style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {total !== null && count === 0 && (
              <div className="empty" role="status" style={{ position: 'absolute', inset: 0, height: 'auto' }}>
                <h2 className="t-title">{text.trim() ? `Nothing matches “${text}”` : (EMPTY[scope]?.[0] ?? (playlistId ? 'This playlist is empty' : 'No songs yet'))}</h2>
                <p className="ink-2">{text.trim() ? 'Accents and case don’t matter. Try an artist or album name.' : (EMPTY[scope]?.[1] ?? (playlistId ? 'Right-click any song and choose Add to playlist.' : 'Add a music folder from the Albums tab and songs appear here as they are found.'))}</p>
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
                    <span className="t-label ink-2" role="gridcell" style={{ textAlign: 'right' }}>{it.index + 1}</span>
                    <span /><span className="skel" style={{ width: '60%' }} /><span className="skel" style={{ width: '40%' }} /><span className="skel" style={{ width: '40%' }} /><span /><span /><span /><span />
                  </div>
                )
              }
              const isNow = s.path === nowPath
              const reorder = !!playlistId && sort === 'position' && dir === 'asc'
              return (
                <div key={it.key} role="row" aria-rowindex={it.index + 2} aria-selected={isSel} className={`srow${isSel ? ' sel' : ''}${it.index === focus ? ' foc' : ''}${isNow ? ' now' : ''}${dropAt === it.index ? ' drop' : ''}`}
                  style={{ ...pos, opacity: s.offline ? 0.4 : 1 }}
                  draggable={reorder}
                  onDragStart={(e) => { dragFrom.current = it.index; e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={(e) => { if (reorder && dragFrom.current !== null) { e.preventDefault(); setDropAt(it.index) } }}
                  onDragLeave={() => setDropAt((d) => (d === it.index ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = rowAt(dragFrom.current ?? -1)?.pos
                    const to = s.pos
                    dragFrom.current = null
                    setDropAt(null)
                    if (playlistId && from !== undefined && to !== undefined && from !== to) void bridge.libraryCall({ op: 'playlistMove', id: playlistId, from, to })
                  }}
                  onDragEnd={() => { dragFrom.current = null; setDropAt(null) }}
                  onClick={(e) => { setFocus(it.index); setSel((p) => applyClick(p, it.index, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })) }}
                  onContextMenu={(e) => {
                    const inSel = sel.indices.has(it.index)
                    const idx = inSel ? [...sel.indices].sort((a, b) => a - b) : [it.index]
                    if (!inSel) { setFocus(it.index); setSel(applyClick(emptySelection, it.index, { shift: false, toggle: false })) }
                    const rows = idx.map(rowAt).filter((r): r is LibrarySong => !!r)
                    const positions = rows.map((r) => r.pos).filter((p): p is number => p !== undefined)
                    openMenu(e, songMenu(rows, playlistId ? { inPlaylist: { id: playlistId, positions } } : {}))
                  }}
                  onDoubleClick={() => !s.offline && playFrom(it.index)}>
                  <span className="t-label ink-2 num" role="gridcell" style={{ textAlign: 'right' }}>{isNow ? <Icon name="waveform" size={14} /> : it.index + 1}</span>
                  <span className="cell" role="gridcell">
                    <button type="button" className={`heart${s.favorite ? ' on' : ''}`} aria-label={s.favorite ? `Remove ${s.title} from Favourites` : `Add ${s.title} to Favourites`} aria-pressed={s.favorite}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(s.path, !s.favorite) }} onDoubleClick={(e) => e.stopPropagation()}>
                      <Icon name="heart" size={16} filled={s.favorite} />
                    </button>
                  </span>
                  <span className="cell" role="gridcell" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <i className="thumb" style={{ background: s.sleeve }} />
                    <span className="ell" dir="auto" style={isNow ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>{s.title}</span>
                    {s.duplicate && <span className="t-label ink-2" title="Another copy of this song is in your library">duplicate</span>}
                  </span>
                  <span className="cell ink-2 ell" role="gridcell" dir="auto">{s.artist}</span>
                  <span className="cell ink-2 ell" role="gridcell" dir="auto">{s.album}</span>
                  <span className="cell t-label ink-2" role="gridcell" style={{ textAlign: 'right', fontSize: 13 }}>{s.playCount || ''}</span>
                  <span className="cell t-label ink-2" role="gridcell" style={{ textAlign: 'right', fontSize: 13 }}>{timecode(s.durationSec)}</span>
                  <span className="cell t-label ink-2" role="gridcell" style={{ textAlign: 'right', fontSize: 12 }} title={loudnessTitle(s)}>{s.dr != null ? `DR ${Math.round(s.dr)}` : ''}</span>
                  <span className="cell" role="gridcell" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }} title={songQualityLabel(s)}>
                    <PurityMeter f={s} width={48} />
                    <span className="t-label ink-2 ell">{s.offline ? 'offline' : s.lossless ? `${s.bitDepth ?? 16}/${+(s.sampleRate / 1000).toFixed(1)}` : s.codec.toUpperCase()}</span>
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
