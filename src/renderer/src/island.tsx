import { StrictMode, useEffect, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { motion, useReducedMotion } from 'framer-motion'
import { ACTIVITY_DWELL_MS, COLLAPSE_GRACE_MS, ERROR_DWELL_MS, HOVER_INTENT_MS, initialIsland, islandGeometry, islandReducer, restFor } from '@shared/islandMachine'
import { hueTint } from '@shared/tags'
import { timecode } from '@shared/library'
import '@fontsource-variable/archivo/wght.css'
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
  const dur = np?.durationSec ?? 0
  const reduce = useReducedMotion()
  const hoverTimer = useRef<number>()
  const leaveTimer = useRef<number>()
  const inside = useRef(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  // Idle with nothing loaded shrinks to the dot; a loaded track rests as the compact pill.
  useEffect(() => dispatch({ type: 'rest', rest: restFor(!!np) }), [np])

  // A new track announces itself briefly (never over an expanded island: the reducer ignores it).
  const path = np?.path
  useEffect(() => {
    if (!path) return undefined
    setMsg('Now playing')
    dispatch({ type: 'activity' })
    const id = window.setTimeout(() => dispatch({ type: 'dismiss' }), ACTIVITY_DWELL_MS)
    return () => window.clearTimeout(id)
  }, [path])

  // Engine toasts / errors (unreadable file, device change) surface as the error state.
  const problem = pb.error ?? pb.toast
  useEffect(() => {
    if (!problem) return undefined
    setMsg(problem)
    dispatch({ type: 'error' })
    const id = window.setTimeout(() => dispatch({ type: 'dismiss' }), ERROR_DWELL_MS)
    return () => window.clearTimeout(id)
  }, [problem])

  // The window is click-through except over the pill; expanded keeps it interactive.
  const interactive = m.state === 'expanded' || inside.current
  useEffect(() => bridge.setIslandInteractive(interactive), [interactive, m.state])

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
  const st = m.state
  const full = st === 'hover' || st === 'expanded'
  const art = st === 'compact' ? 24 : st === 'hover' ? 60 : st === 'expanded' ? 64 : 28
  const tint = guarded(np ? hueTint(np.title) : undefined)
  const shown = drag ?? pos
  const commit = (): void => {
    if (drag !== null) send({ type: 'seek', seconds: drag })
    setDrag(null)
  }
  const ctl = (label: string, icon: 'prev' | 'next' | 'play' | 'pause', cmd: Parameters<typeof send>[0], size = 20): JSX.Element => (
    <button type="button" aria-label={label} onClick={(e) => { e.stopPropagation(); send(cmd) }}
      style={{ border: 0, background: 'transparent', color: 'inherit', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>
      <Icon name={icon} size={size} filled />
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
      <motion.div
        role="region"
        aria-label="Now playing island"
        aria-live={st === 'error' ? 'assertive' : 'off'}
        initial={false}
        animate={{ width: g.w, height: g.h, borderRadius: g.r }}
        transition={reduce ? { duration: 0.15 } : SPRING}
        onPointerEnter={() => {
          inside.current = true
          window.clearTimeout(leaveTimer.current)
          bridge.setIslandInteractive(true)
          window.clearTimeout(hoverTimer.current)
          hoverTimer.current = window.setTimeout(() => dispatch({ type: 'pointer-enter' }), HOVER_INTENT_MS)
        }}
        onPointerLeave={() => {
          inside.current = false
          window.clearTimeout(hoverTimer.current)
          const leave = (): void => {
            dispatch({ type: 'pointer-leave' })
            if (!inside.current) bridge.setIslandInteractive(false)
          }
          // Expanded gets a grace period so a slip off the edge doesn't collapse a scrub in progress.
          if (m.state === 'expanded' && drag === null) leaveTimer.current = window.setTimeout(leave, COLLAPSE_GRACE_MS)
          else leave()
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
        {st === 'dot' ? (
          <div role="img" aria-label="Flacon, nothing playing" style={{ position: 'absolute', inset: 0, background: 'rgb(237 237 232 / .5)' }} />
        ) : (
          <>
            {/* Liquid: the tint fills to playback progress; colour changes over 600 ms, nothing else moves. */}
            {np && st !== 'activity' && st !== 'error' && (
              <div style={{ position: 'absolute', left: 0, bottom: 0, height: st === 'expanded' ? 34 : '100%', width: `${dur ? Math.min(100, (shown / dur) * 100) : 0}%`, background: `color-mix(in srgb, ${tint} 70%, transparent)`, transition: 'background-color 600ms ease-in-out' }} />
            )}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: `0 ${Math.max(6, g.h / 6)}px`, height: st === 'expanded' ? 'auto' : '100%', paddingTop: st === 'expanded' ? 16 : 0 }}>
              {st === 'error' ? (
                <>
                  <span aria-hidden style={{ width: 20, height: 20, borderRadius: '50%', border: '1.5px solid var(--warn)', color: 'var(--warn)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>!</span>
                  <div style={{ minWidth: 0, flex: 1, fontSize: 13, color: 'var(--warn)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} dir="auto" title={msg}>{msg}</div>
                </>
              ) : (
                <>
                  {np && <div style={{ width: art, height: art, borderRadius: 2, flexShrink: 0, background: `linear-gradient(135deg, ${tint}, rgb(237 237 232 / .16))` }} />}
                  <div style={{ minWidth: 0, flex: 1, fontSize: 13, lineHeight: '18px' }}>
                    {st === 'activity' && <div style={{ color: 'rgba(237,237,232,.62)', fontSize: 11 }}>{msg}</div>}
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} dir="auto">{np?.title ?? 'Nothing playing'}</div>
                    {full && np && <div style={{ color: 'rgba(237,237,232,.62)' }}>{np.bitDepth ? `${np.bitDepth} bit · ` : ''}{(np.sampleRate / 1000).toString()} kHz · {np.codec.toUpperCase()}</div>}
                  </div>
                  {full && (
                    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {ctl('Previous', 'prev', { type: 'prev' })}
                      {ctl(playing ? 'Pause' : 'Play', playing ? 'pause' : 'play', { type: 'toggle' }, 22)}
                      {ctl('Next', 'next', { type: 'next' })}
                    </div>
                  )}
                </>
              )}
            </div>
            {st === 'expanded' && np && (
              <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12 }} onClick={(e) => e.stopPropagation()}>
                <input type="range" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.floor(shown)} aria-label="Position" aria-valuetext={`${timecode(shown)} of ${timecode(dur)}`}
                  onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} style={{ width: '100%' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(237,237,232,.62)' }}>
                  <span>{timecode(shown)}</span><span>−{timecode(Math.max(0, dur - shown))}</span>
                </div>
              </div>
            )}
          </>
        )}
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
