import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { Icon } from './icons'

/** One global context menu: pointer-positioned, arrow-key navigable, closes on Esc / outside click / scroll. */
export function ContextMenu(): JSX.Element | null {
  const menu = useStore((s) => s.ctxMenu)
  const close = useStore((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)) })
    ref.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
    const away = (e: Event): void => { if (!ref.current?.contains(e.target as Node)) close() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('wheel', close)
      window.removeEventListener('blur', close)
    }
  }, [menu, close])

  if (!menu) return null
  return (
    <div ref={ref} className="ctx" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it) => (
        <div key={it.label} role="none">
          {it.divider && <div className="ctx-div" role="separator" />}
          <button type="button" role="menuitem" className={`ctx-item${it.danger ? ' danger' : ''}`} disabled={it.disabled} onClick={() => { close(); it.onClick() }}>
            <span className="ctx-ic">{it.icon && <Icon name={it.icon} size={16} />}</span>
            <span>{it.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
