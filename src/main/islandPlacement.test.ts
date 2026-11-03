import { describe, expect, it } from 'vitest'
import { hasNotch, ISLAND_WINDOW, islandBounds } from './islandPlacement'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe('island placement', () => {
  it('detects a notch only on macOS with a tall menu-bar inset', () => {
    const notched = { bounds: rect(0, 0, 1512, 982), workArea: rect(0, 38, 1512, 944) }
    const plain = { bounds: rect(0, 0, 1440, 900), workArea: rect(0, 25, 1440, 875) }
    expect(hasNotch(notched, 'darwin')).toBe(true)
    expect(hasNotch(plain, 'darwin')).toBe(false)
    expect(hasNotch(notched, 'win32')).toBe(false)
  })
  it('centres on the display and anchors to the physical top on a notched Mac', () => {
    const d = { bounds: rect(0, 0, 1512, 982), workArea: rect(0, 38, 1512, 944) }
    const b = islandBounds(d, 'darwin')
    expect(b.y).toBe(0)
    expect(b.x + b.width / 2).toBe(756)
  })
  it('uses the work area on a plain display and on a secondary display with an offset', () => {
    const d = { bounds: rect(1920, -200, 2560, 1440), workArea: rect(1920, -200, 2560, 1400) }
    const b = islandBounds(d, 'win32')
    expect(b.y).toBe(-200)
    expect(b.x + b.width / 2).toBe(1920 + 1280)
  })
  it('sits above the taskbar when docked to the bottom on Windows', () => {
    const d = { bounds: rect(0, 0, 1920, 1080), workArea: rect(0, 0, 1920, 1040) }
    const b = islandBounds(d, 'win32', 'bottom')
    expect(b.y + ISLAND_WINDOW.height).toBe(1040)
  })
})
