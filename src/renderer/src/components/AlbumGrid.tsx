import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Album } from '@shared/library'
import { AlbumCard } from './AlbumCard'

const COLS = 4
const GAP_X = 24
const GAP_Y = 32
const TEXT_H = 12 + 20 + 20 + 8 + 2 + 8 + 16 // title/artist/fill line/label under the sleeve

interface Props {
  albums: Album[]
  vesselLeft: () => number
  onDragState: (over: boolean) => void
  onPour: (album: Album) => void
  onPlay: (album: Album) => void
}

// Rows are virtualized so 100k-track libraries (thousands of albums) scroll at 60 fps.
// Row height is derived from the measured width: square sleeve + fixed text block.
export function AlbumGrid({ albums, vesselLeft, onDragState, onPour, onPlay }: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const colW = (width - GAP_X * (COLS - 1)) / COLS
  const rowH = Math.round(colW + TEXT_H + GAP_Y)
  const rows = Math.ceil(albums.length / COLS)
  const virt = useVirtualizer({ count: rows, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 3, paddingStart: 24 })

  useEffect(() => virt.measure(), [rowH, virt])

  return (
    <div className="scroll" ref={scrollRef}>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((row) => (
          <div
            key={row.key}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rowH - GAP_Y, transform: `translateY(${row.start}px)`, display: 'grid', gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, columnGap: GAP_X }}
          >
            {albums.slice(row.index * COLS, row.index * COLS + COLS).map((a) => (
              <AlbumCard key={a.id} album={a} vesselLeft={vesselLeft} onDragState={onDragState}
                onRelease={(album, x) => {
                  const inside = x > vesselLeft()
                  if (inside) onPour(album)
                  return inside
                }}
                onPlay={onPlay} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
