import type { Display, Rectangle } from 'electron'
import { islandGeometry } from '@shared/islandMachine'

// The island window is sized once to the largest expanded state plus shadow room; the pill
// animates inside it (never animate native window bounds: it janks).
export const ISLAND_WINDOW = { width: islandGeometry.expanded.w + 80, height: islandGeometry.expanded.h + 80 }

/** A notch shows up as a menu-bar inset taller than a plain 24px bar. */
export function hasNotch(d: Pick<Display, 'bounds' | 'workArea'>, platform: NodeJS.Platform): boolean {
  return platform === 'darwin' && d.workArea.y - d.bounds.y >= 32
}

export function islandBounds(
  d: Pick<Display, 'bounds' | 'workArea'>,
  platform: NodeJS.Platform,
  edge: 'top' | 'bottom' = 'top'
): Rectangle {
  const x = Math.round(d.bounds.x + d.bounds.width / 2 - ISLAND_WINDOW.width / 2)
  if (edge === 'bottom' && platform === 'win32') {
    // Sit just above the taskbar (workArea already excludes it, in any docking position).
    return { x, y: d.workArea.y + d.workArea.height - ISLAND_WINDOW.height, ...ISLAND_WINDOW }
  }
  // Offset 8px (island.offsetTop) below the menu bar / screen top; on notched Macs the compact
  // pill straddles the notch, so we anchor to the physical top instead of the work area.
  const top = hasNotch(d, platform) ? d.bounds.y : d.workArea.y
  return { x, y: top, ...ISLAND_WINDOW }
}
