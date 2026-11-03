// Multi-select for the songs table: plain click selects one, Ctrl/Cmd-click toggles, Shift-click
// selects the range from the anchor. Indices (not ids) so it works on rows that are not loaded yet.

export interface Selection {
  anchor: number | null
  indices: ReadonlySet<number>
}

export const emptySelection: Selection = { anchor: null, indices: new Set() }

export function applyClick(sel: Selection, index: number, mod: { shift: boolean; toggle: boolean }): Selection {
  if (mod.shift && sel.anchor !== null) {
    const [a, b] = sel.anchor < index ? [sel.anchor, index] : [index, sel.anchor]
    const next = mod.toggle ? new Set(sel.indices) : new Set<number>()
    for (let i = a; i <= b; i++) next.add(i)
    return { anchor: sel.anchor, indices: next }
  }
  if (mod.toggle) {
    const next = new Set(sel.indices)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return { anchor: index, indices: next }
  }
  return { anchor: index, indices: new Set([index]) }
}

/** Arrow-key movement; Shift extends from the anchor. */
export function moveFocus(sel: Selection, from: number, delta: number, total: number, extend: boolean): { focus: number; selection: Selection } {
  const focus = Math.max(0, Math.min(total - 1, from + delta))
  return { focus, selection: applyClick(sel, focus, { shift: extend, toggle: false }) }
}
