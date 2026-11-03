import { StrictMode, useEffect, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { motion, useReducedMotion } from 'framer-motion'
import { ACTIVITY_DWELL_MS, COLLAPSE_GRACE_MS, ERROR_DWELL_MS, HOVER_INTENT_MS, geometryFor, initialIsland, islandReducer, restFor } from '@shared/islandMachine'
import type { AppSettingsInfo } from '@shared/ipc'
import { hueTint } from '@shared/tags'
import { timecode } from '@shared/library'
import { purityBadge, purityTier, type PurityTier } from '@shared/purity'
import '@fontsource-variable/archivo/wght.css'
import './styles/tokens.css'
import './styles/island.css'
import { bridge } from './lib/bridge'
import { guarded, initApp, useStore } from './store'
import { Icon } from './components/icons'

// Design baseline spring: stiffness 380, damping 30, mass 1.
const SPRING = { type: 'spring', stiffness: 380, damping: 30, mass: 1 } as const
// The island is always black, so tier colours are fixed light tones rather than the theme's.
const TIER_ON_BLACK: Record<PurityTier, string> = { pure: '#8fe0b0', good: '#b9d98a', limited: '#f0c46a', thin: '#ff9a7a' }

function Bars({ on }: { on: boolean }): JSX.Element {
  return <span className={`isl-bars${on ? ' on' : ''}`} aria-hidden><i /><i /><i /></span>
}

function Island(): JSX.Element | null {
  const [m, dispatch] = useReducer(islandReducer, initialIsland)
  const [cfg, setCfg] = useState<AppSettingsInfo | null>(null)
  const pb = useStore((s) => s.pb)
  const send = useStore((s) => s.send)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const np = pb.track
  const meta = pb.meta
  const playing = pb.status === 'playing'
  const pos = pb.positionSec
  const dur = np?.durationSec ?? 0
  const reduce = useReducedMotion()
  const hoverTimer = useRef<number>()
  const leaveTimer = useRef<number>()
  const [over, setOver] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void bridge.getSettings().then(setCfg)
    return bridge.onSettings(setCfg)
  }, [])
  const size = cfg?.islandSize ?? 'comfortable'
  const showArt = cfg?.islandArt ?? true
  const showBadge = cfg?.islandBadge ?? true
  const onlyWhenPlaying = cfg?.islandMode === 'playing'

  // Idle with nothing loaded shrinks to the dot (or vanishes in "While playing" mode); a loaded track rests as the pill.
  const hasTrack = !!np
  useEffect(() => {
    if (onlyWhenPlaying && !hasTrack) dispatch({ type: 'hide' })
    else {
      dispatch({ type: 'show' })
      dispatch({ type: 'rest', rest: restFor(hasTrack) })
    }
  }, [hasTrack, onlyWhenPlaying])

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

  // The window is click-through except over the pill. One source of truth: pointer-over OR expanded.
  const interactive = m.state !== 'hidden' && (over || m.state === 'expanded')
  useEffect(() => bridge.setIslandInteractive(interactive), [interactive])

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
      window.clearTimeout(hoverTimer.current)
      window.clearTimeout(leaveTimer.current)
    }
  }, [])

  if (m.state === 'hidden') return null
  const st = m.state
  const g = geometryFor(st, size)
  const full = st === 'hover' || st === 'expanded'
  const art = st === 'compact' ? 24 : st === 'hover' ? 60 : st === 'expanded' ? 72 : 28
  const tint = guarded(np ? hueTint(np.title) : undefined)
  const shown = drag ?? pos
  const commit = (): void => {
    if (drag !== null) send({ type: 'seek', seconds: drag })
    setDrag(null)
  }
  const ctl = (label: string, icon: 'prev' | 'next' | 'play' | 'pause', cmd: Parameters<typeof send>[0], big = false): JSX.Element => (
    <button type="button" className={`isl-btn${big ? ' big' : ''}`} aria-label={label} onClick={(e) => { e.stopPropagation(); send(cmd) }}>
      <Icon name={icon} size={big ? 24 : 18} filled />
    </button>
  )
  const badge = meta && showBadge && meta.lossless ? purityBadge(meta) : ''
  const badgeColor = meta?.purity != null ? TIER_ON_BLACK[purityTier(meta.purity)] : 'rgb(237 237 232 / .62)'
  const sub = np ? [meta?.artist, np.bitDepth ? `${np.bitDepth} bit` : '', `${(np.sampleRate / 1000).toString()} kHz`, np.codec.toUpperCase()].filter(Boolean).join(' · ') : ''

  const enter = (): void => {
    window.clearTimeout(leaveTimer.current)
    setOver(true)
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => dispatch({ type: 'pointer-enter' }), HOVER_INTENT_MS)
  }
  const leave = (): void => {
    window.clearTimeout(hoverTimer.current)
    const done = (): void => { setOver(false); dispatch({ type: 'pointer-leave' }) }
    // Expanded gets a grace period so a slip off the edge doesn't collapse a scrub in progress.
    if (st === 'expanded' && drag === null) leaveTimer.current = window.setTimeout(done, COLLAPSE_GRACE_MS)
    else done()
  }

  return (
    <div className="isl-stage">
      {/* The dot is 8 px: its hover target is the larger invisible hit area around it. */}
      <motion.div
        role="region"
        aria-label="Now playing island"
        aria-live={st === 'error' ? 'assertive' : 'off'}
        className={`isl isl-${st}`}
        initial={false}
        animate={{ width: g.w, height: g.h, borderRadius: g.r }}
        transition={reduce ? { duration: 0.15 } : SPRING}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={() => dispatch({ type: 'click' })}
        onContextMenu={(e) => e.preventDefault()}
      >
        {st === 'dot' ? (
          <div role="img" aria-label="Flacon, nothing playing" className="isl-dot" />
        ) : (
          <>
            {np && st !== 'activity' && st !== 'error' && st !== 'expanded' && (
              <div className="isl-liquid" style={{ width: `${dur ? Math.min(100, (shown / dur) * 100) : 0}%`, background: `color-mix(in srgb, ${tint} 55%, transparent)` }} />
            )}
            <div className={`isl-row${st === 'expanded' ? ' tall' : ''}`}>
              {st === 'error' ? (
                <>
                  <span aria-hidden className="isl-warn"><Icon name="warn" size={14} /></span>
                  <div className="isl-msg" dir="auto" title={msg}>{msg}</div>
                </>
              ) : (
                <>
                  {np && showArt && (
                    <button type="button" className="isl-art" aria-label="Open Flacon" style={{ width: art, height: art, background: meta?.artUrl ? `center / cover url("${meta.artUrl}")` : `linear-gradient(135deg, ${tint}, rgb(237 237 232 / .16))` }}
                      onClick={(e) => { e.stopPropagation(); if (full) bridge.showMain(); else dispatch({ type: 'click' }) }} />
                  )}
                  <div className="isl-text">
                    {st === 'activity' && <div className="isl-kicker">{msg}</div>}
                    <div className="isl-title" dir="auto">{np?.title ?? 'Nothing playing'}</div>
                    {full && np && <div className="isl-sub" dir="auto">{sub}</div>}
                    {st === 'expanded' && badge && <div className="isl-badge" style={{ color: badgeColor }}>{badge}</div>}
                  </div>
                  {np && (st === 'compact' || st === 'activity') && <Bars on={playing} />}
                  {st === 'hover' && (
                    <div className="isl-ctl">
                      {ctl('Previous', 'prev', { type: 'prev' })}
                      {ctl(playing ? 'Pause' : 'Play', playing ? 'pause' : 'play', { type: 'toggle' }, true)}
                      {ctl('Next', 'next', { type: 'next' })}
                    </div>
                  )}
                  {st === 'expanded' && np && (
                    <button type="button" className={`isl-btn${meta?.favorite ? ' on' : ''}`} aria-label={meta?.favorite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={!!meta?.favorite}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(np.path, !meta?.favorite) }}>
                      <Icon name="heart" size={18} filled={!!meta?.favorite} />
                    </button>
                  )}
                </>
              )}
            </div>
            {st === 'expanded' && np && (
              <div className="isl-foot" onClick={(e) => e.stopPropagation()}>
                <div className="isl-scrub">
                  <span>{timecode(shown)}</span>
                  <input type="range" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.floor(shown)} aria-label="Position" aria-valuetext={`${timecode(shown)} of ${timecode(dur)}`}
                    onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} />
                  <span>−{timecode(Math.max(0, dur - shown))}</span>
                </div>
                <div className="isl-ctl wide">
                  <button type="button" className={`isl-btn${pb.shuffle ? ' on' : ''}`} aria-label="Shuffle" aria-pressed={pb.shuffle} onClick={() => send({ type: 'shuffle', on: !pb.shuffle })}><Icon name="shuffle" size={18} /></button>
                  {ctl('Previous', 'prev', { type: 'prev' })}
                  {ctl(playing ? 'Pause' : 'Play', playing ? 'pause' : 'play', { type: 'toggle' }, true)}
                  {ctl('Next', 'next', { type: 'next' })}
                  <button type="button" className={`isl-btn${pb.repeat !== 'off' ? ' on' : ''}`} aria-label={`Repeat: ${pb.repeat}`} onClick={() => send({ type: 'repeat', mode: pb.repeat === 'off' ? 'all' : pb.repeat === 'all' ? 'one' : 'off' })}>
                    <Icon name={pb.repeat === 'one' ? 'repeatOne' : 'repeat'} size={18} />
                  </button>
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
