import { StrictMode, useEffect, useReducer, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { motion, useReducedMotion } from 'framer-motion'
import { HOVER_INTENT_MS, initialIsland, islandGeometry, islandReducer } from '@shared/islandMachine'
import { timecode } from '@shared/library'
import './styles/tokens.css'
import { bridge } from './lib/bridge'
import { guarded, initApp, useStore } from './store'
import { Icon } from './components/icons'

// Design baseline spring: stiffness 380, damping 30, mass 1.
const SPRING = { type: 'spring', stiffness: 380, damping: 30, mass: 1 } as const

function Island(): JSX.Element | null {
  const [m, dispatch] = useReducer(islandReducer, initialIsland)
  const pb = useStore((s) => s.pb)
  const send = useStore((s) => s.send)
  const np = pb.track
  const playing = pb.status === 'playing'
  const pos = pb.positionSec
  const reduce = useReducedMotion()
  const hoverTimer = useRef<number>()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dispatch({ type: 'escape' })
    }
    const onBlur = (): void => dispatch({ type: 'blur' })
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  if (m.state === 'hidden') return null
  const g = islandGeometry[m.state]
  const expanded = m.state === 'expanded'
  const art = m.state === 'compact' ? 24 : m.state === 'hover' ? 60 : expanded ? 64 : 28

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
      <motion.div
        role="region"
        aria-label="Now playing island"
        initial={false}
        animate={{ width: g.w, height: g.h, borderRadius: g.r }}
        transition={reduce ? { duration: 0.15 } : SPRING}
        onPointerEnter={() => {
          bridge.setIslandInteractive(true)
          hoverTimer.current = window.setTimeout(() => dispatch({ type: 'pointer-enter' }), HOVER_INTENT_MS)
        }}
        onPointerLeave={() => {
          window.clearTimeout(hoverTimer.current)
          dispatch({ type: 'pointer-leave' })
          if (m.state !== 'expanded') bridge.setIslandInteractive(false)
        }}
        onClick={() => dispatch({ type: 'click' })}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          background: '#000',
          color: '#ededE8',
          overflow: 'hidden',
          boxShadow: '0 0 0 .5px rgba(255,255,255,.14),0 10px 30px rgba(0,0,0,.35)',
          position: 'relative',
          cursor: 'default'
        }}
      >
        {/* Liquid: the tint fills to playback progress; colour changes over 600 ms, nothing else moves. */}
        <div style={{ position: 'absolute', left: 0, bottom: 0, height: expanded ? 34 : '100%', width: `${np ? Math.min(100, (pos / Math.max(1, np.durationSec)) * 100) : 0}%`, background: `color-mix(in srgb, ${guarded(undefined)} 70%, transparent)`, transition: 'background-color 600ms ease-in-out' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: `0 ${Math.max(6, g.h / 6)}px`, height: expanded ? 'auto' : '100%', paddingTop: expanded ? 16 : 0 }}>
          {np && <div style={{ width: art, height: art, borderRadius: 2, flexShrink: 0, background: 'rgb(237 237 232 / .16)' }} />}
          <div style={{ minWidth: 0, flex: 1, fontSize: 13, lineHeight: '18px' }}>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} dir="auto">{np?.title ?? 'Nothing playing'}</div>
            {m.state !== 'compact' && <div style={{ color: 'rgba(237,237,232,.62)' }} dir="auto">{timecode(pos)}</div>}
          </div>
          {m.state !== 'compact' && (
            <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={(e) => { e.stopPropagation(); send({ type: 'toggle' }) }}
              style={{ border: 0, background: 'transparent', color: 'inherit', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>
              <Icon name={playing ? 'pause' : 'play'} size={20} filled={!playing} />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

initApp()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Island />
  </StrictMode>
)
