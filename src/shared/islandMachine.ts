import type { IslandStateName } from './ipc'

// Single typed reducer driving every island state (design: C2). Pure, so it is unit-testable;
// the 150 ms hover-intent delay is applied by the caller via `HOVER_INTENT_MS`.

export const HOVER_INTENT_MS = 150
export const ACTIVITY_DWELL_MS = 2500
export const ERROR_DWELL_MS = 5000
/** Grace before an expanded island collapses after the pointer leaves it. */
export const COLLAPSE_GRACE_MS = 500

export interface IslandModel {
  state: IslandStateName
  /** State to return to when an activity/error finishes. */
  rest: Extract<IslandStateName, 'compact' | 'dot' | 'hidden'>
}

export type IslandEvent =
  | { type: 'pointer-enter' }
  | { type: 'pointer-leave' }
  | { type: 'click' }
  | { type: 'escape' }
  | { type: 'blur' }
  | { type: 'activity' }
  | { type: 'error' }
  | { type: 'dismiss' }
  | { type: 'rest'; rest: IslandModel['rest'] }
  | { type: 'hide' }
  | { type: 'show' }

/** Resting presentation for a playback status: idle with no track shrinks to the dot. */
export function restFor(hasTrack: boolean): IslandModel['rest'] {
  return hasTrack ? 'compact' : 'dot'
}

export const initialIsland: IslandModel = { state: 'compact', rest: 'compact' }

export function islandReducer(m: IslandModel, e: IslandEvent): IslandModel {
  switch (e.type) {
    case 'hide':
      return { state: 'hidden', rest: 'hidden' }
    case 'show':
      return m.state === 'hidden' ? { state: 'compact', rest: 'compact' } : m
    case 'pointer-enter':
      return m.state === 'compact' || m.state === 'dot' ? { ...m, state: 'hover' } : m
    case 'pointer-leave':
      return m.state === 'hover' || m.state === 'expanded' ? { ...m, state: m.rest } : m
    case 'rest':
      // Nothing to play → a dot; a loaded track → the compact pill. Never disturb a visible state.
      if (m.state === 'hidden') return m
      return m.state === 'compact' || m.state === 'dot' ? { state: e.rest, rest: e.rest } : { ...m, rest: e.rest }
    case 'click':
      if (m.state === 'hover' || m.state === 'compact' || m.state === 'dot') return { ...m, state: 'expanded' }
      return m
    case 'escape':
    case 'blur':
      return m.state === 'expanded' || m.state === 'hover' ? { ...m, state: m.rest } : m
    case 'activity':
      // Never interrupt an expanded island the user is touching.
      return m.state === 'expanded' || m.state === 'hidden' ? m : { ...m, state: 'activity' }
    case 'error':
      return m.state === 'hidden' ? m : { ...m, state: 'error' }
    case 'dismiss':
      return m.state === 'activity' || m.state === 'error' ? { ...m, state: m.rest } : m
  }
}

/** Geometry from the handoff tokens (island.*). Window is sized to the largest state once. */
export const islandGeometry = {
  dot: { w: 8, h: 8, r: 4 },
  compact: { w: 200, h: 36, r: 18 },
  hover: { w: 360, h: 84, r: 28 },
  expanded: { w: 400, h: 168, r: 32 },
  activity: { w: 300, h: 44, r: 22 },
  error: { w: 320, h: 44, r: 22 },
  hidden: { w: 0, h: 0, r: 0 }
} as const satisfies Record<IslandStateName, { w: number; h: number; r: number }>
