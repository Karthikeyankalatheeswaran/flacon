import { create } from 'zustand'
import type { AppState, ThemeSetting } from '@shared/ipc'
import { sampleAlbums, type Album } from '@shared/library'
import { initialPlayback, type PlaybackCommand, type PlaybackState } from '@shared/playback'
import { guardTint } from '@shared/tint'
import { bridge } from './lib/bridge'

interface UiState {
  app: AppState | null
  albums: Album[]
  /** Queue held in the vessel (design: "pour an album"). Album ids in order. */
  queue: string[]
  /** Real playback state from the audio engine (via main). */
  pb: PlaybackState
  setTheme: (t: ThemeSetting) => Promise<void>
  pour: (id: string) => void
  send: (c: PlaybackCommand) => void
  openFiles: () => Promise<void>
}

export const useStore = create<UiState>((set) => ({
  app: null,
  albums: sampleAlbums,
  queue: ['a3', 'a9'],
  pb: initialPlayback,
  setTheme: (t) => bridge.setTheme(t),
  pour: (id) => set((s) => (s.queue.includes(id) ? s : { queue: [...s.queue, id] })),
  send: (c) => bridge.sendPlayback(c),
  openFiles: () => bridge.openFiles()
}))

/** Contrast-guarded tint for a record's colour (falls back to the foundations teal). */
export const guarded = (hex: string | undefined): string => guardTint(hex ?? '#13303A')

// Bridge state → store; applies the resolved theme to <html data-theme>.
export function initApp(): () => void {
  const apply = (app: AppState): void => {
    document.documentElement.dataset['theme'] = app.resolvedTheme
    document.documentElement.dataset['platform'] = app.platform
    useStore.setState({ app })
  }
  void bridge.getState().then(apply)
  void bridge.getPlayback().then((pb) => useStore.setState({ pb }))
  const offA = bridge.onState(apply)
  const offP = bridge.onPlayback((pb) => useStore.setState({ pb }))
  return () => {
    offA()
    offP()
  }
}
