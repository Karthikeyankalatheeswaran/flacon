import type { Display, Rectangle } from 'electron'
import { islandGeometry } from '@shared/islandMachine'

// The island window is sized once to the largest expanded state plus shadow room; the pill
// animates inside it (never animate native window bounds: it janks).
export const ISLAND_WINDOW = { width: islandGeometry.expanded.w + 80, height: islandGeometry.expanded.h + 80 }

export type IslandEdge = 'top' | 'bottom'
export type IslandAlign = 'left' | 'center' | 'right'
export interface IslandSpot { edge: IslandEdge; align: IslandAlign }
export const ISLAND_SPOTS: IslandSpot[] = (['top', 'bottom'] as const).flatMap((edge) => (['left', 'center', 'right'] as const).map((align) => ({ edge, align })))
const SIDE_MARGIN = 12

/** A notch shows up as a menu-bar inset taller than a plain 24px bar. */
export function hasNotch(d: Pick<Display, 'bounds' | 'workArea'>, platform: NodeJS.Platform): boolean {
  return platform === 'darwin' && d.workArea.y - d.bounds.y >= 32
}

export function islandBounds(
  d: Pick<Display, 'bounds' | 'workArea'>,
  platform: NodeJS.Platform,
  edge: IslandEdge = 'top',
  align: IslandAlign = 'center'
): Rectangle {
  const w = d.workArea
  const x =
    align === 'left' ? w.x + SIDE_MARGIN
    : align === 'right' ? w.x + w.width - SIDE_MARGIN - ISLAND_WINDOW.width
    : Math.round(d.bounds.x + d.bounds.width / 2 - ISLAND_WINDOW.width / 2)
  if (edge === 'bottom') {
    // Just above the Dock / taskbar (workArea already excludes it, in any docking position); the pill grows upward.
    return { x, y: w.y + w.height - ISLAND_WINDOW.height, ...ISLAND_WINDOW }
  }
  // Offset 8px (island.offsetTop) below the menu bar / screen top; on notched Macs the compact
  // pill straddles the notch, so we anchor to the physical top instead of the work area (centre only).
  const top = align === 'center' && hasNotch(d, platform) ? d.bounds.y : w.y
  return { x, y: top, ...ISLAND_WINDOW }
}

/** Which of the six spots a point is closest to: top/bottom half of the work area, and its left/middle/right third. */
export function nearestSpot(d: Pick<Display, 'workArea'>, p: { x: number; y: number }): IslandSpot {
  const w = d.workArea
  const edge: IslandEdge = p.y < w.y + w.height / 2 ? 'top' : 'bottom'
  const third = (p.x - w.x) / w.width
  return { edge, align: third < 1 / 3 ? 'left' : third > 2 / 3 ? 'right' : 'center' }
}
