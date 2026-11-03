import { motion, type PanInfo } from 'framer-motion'
import { fillPercent, qualityLabel, type Album } from '@shared/library'

interface Props {
  album: Album
  /** Called on release with the pointer position projected by its momentum. */
  onRelease: (album: Album, projectedX: number) => boolean
  onDragState: (over: boolean) => void
  vesselLeft: () => number
  onPlay: (album: Album) => void
}

// Pour: tracks 1:1 from the grab point; on release project x + v·0.998/(1−0.998). A projection
// inside the vessel queues it; anything else springs home the way it came (design: Motion › Pour).
const DECEL = 0.998

export function AlbumCard({ album, onRelease, onDragState, vesselLeft, onPlay }: Props): JSX.Element {
  const hi = album.quality === 'hires'
  const up = album.quality === 'upscaled'
  const lossy = album.quality === 'lossy'
  const flColor = hi ? 'var(--tint-ink)' : lossy ? 'var(--ink-2)' : 'var(--ink)'
  const track = up ? 'repeating-linear-gradient(90deg,var(--warn) 0 1px,transparent 1px 4px)' : 'var(--rule)'

  const release = (_: PointerEvent, info: PanInfo): void => {
    onDragState(false)
    onRelease(album, info.point.x + (info.velocity.x * DECEL) / (1 - DECEL) / 1000)
  }

  return (
    <motion.div
      className="card"
      role="button"
      tabIndex={0}
      onDoubleClick={() => !album.offline && onPlay(album)}
      onKeyDown={(e) => e.key === 'Enter' && !album.offline && onPlay(album)}
      aria-label={`${album.title}, ${album.artist}. Press Enter to play, or drag into the vessel to pour.`}
      drag
      dragSnapToOrigin
      dragElastic={1}
      dragTransition={{ bounceStiffness: 380, bounceDamping: 30 }}
      whileDrag={{ zIndex: 20, rotate: -2, scale: 1.02, boxShadow: '0 22px 44px rgba(0,0,0,.3)' }}
      onDrag={(_, info) => onDragState(info.point.x > vesselLeft())}
      onDragEnd={release}
      style={{ opacity: album.offline ? 0.4 : 1 }}
    >
      <div className="sleeve" style={{ background: album.sleeve }}>
        {album.bigGlyph && <b className="big" style={{ color: album.bigGlyphColor }}>{album.bigGlyph}</b>}
        {album.sleeveText && <span className="tx" style={{ color: album.sleeveTextColor }}>{album.sleeveText}</span>}
      </div>
      <div className="line1" style={{ fontWeight: 600, marginTop: 12 }} dir="auto">{album.title}</div>
      <div className="line1 ink-2" dir="auto">{album.artist}</div>
      <div className="fill" role="img" aria-label={up ? 'Upscaled' : hi ? 'Verified hi-res' : lossy ? 'Lossy' : 'CD quality, full'} style={{ background: track }}>
        <b style={{ width: `${fillPercent(album)}%`, background: flColor }} />
        <i />
      </div>
      <span className="t-label" style={{ color: up ? 'var(--warn)' : 'var(--ink-2)', marginTop: 8 }}>{qualityLabel(album)}</span>
    </motion.div>
  )
}
