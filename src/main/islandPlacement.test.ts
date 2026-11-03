import { describe, expect, it } from 'vitest'
import { hasNotch, ISLAND_SPOTS, ISLAND_WINDOW, islandBounds, nearestSpot } from './islandPlacement'

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
  it('sits above the Dock on macOS too, and grows upward from there', () => {
    const d = { bounds: rect(0, 0, 1440, 900), workArea: rect(0, 25, 1440, 800) }
    expect(islandBounds(d, 'darwin', 'bottom').y + ISLAND_WINDOW.height).toBe(825)
  })
  it('aligns to the left and right with a small margin, fully on screen', () => {
    const d = { bounds: rect(0, 0, 1440, 900), workArea: rect(0, 25, 1440, 875) }
    expect(islandBounds(d, 'darwin', 'top', 'left').x).toBe(12)
    const r = islandBounds(d, 'darwin', 'top', 'right')
    expect(r.x + r.width).toBe(1440 - 12)
  })
  it('keeps the notch anchor only for the centred top spot', () => {
    const d = { bounds: rect(0, 0, 1512, 982), workArea: rect(0, 38, 1512, 944) }
    expect(islandBounds(d, 'darwin', 'top', 'center').y).toBe(0)
    expect(islandBounds(d, 'darwin', 'top', 'left').y).toBe(38)
  })
  it('snaps a drop point to the nearest of six spots', () => {
    const d = { workArea: rect(0, 25, 1500, 875) }
    expect(ISLAND_SPOTS).toHaveLength(6)
    expect(nearestSpot(d, { x: 100, y: 40 })).toEqual({ edge: 'top', align: 'left' })
    expect(nearestSpot(d, { x: 750, y: 60 })).toEqual({ edge: 'top', align: 'center' })
    expect(nearestSpot(d, { x: 1400, y: 800 })).toEqual({ edge: 'bottom', align: 'right' })
    expect(nearestSpot(d, { x: 740, y: 880 })).toEqual({ edge: 'bottom', align: 'center' })
  })
})
