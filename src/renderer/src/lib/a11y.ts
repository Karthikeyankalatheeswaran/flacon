import type { KeyboardEvent } from 'react'

/** Arrow/Home/End navigation for a `role=tablist`: moves focus and activates the target tab (automatic activation). */
export function tabKeys(e: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]:not(:disabled)')]
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement)
  if (!tabs.length || i < 0) return
  e.preventDefault()
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[next]!.focus()
  tabs[next]!.click()
}

/** True when a key press belongs to a control that needs it (typing, sliders, buttons, menus). */
export function isInteractiveTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.closest('[role=table],[role=dialog],[role=slider],[role=tab]') !== null
}
