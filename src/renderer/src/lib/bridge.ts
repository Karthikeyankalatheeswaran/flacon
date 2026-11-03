import type { AppState, FlaconBridge, ThemeSetting } from '@shared/ipc'
import { sampleAlbums } from '@shared/library'
import { initialPlayback, type PlaybackState } from '@shared/playback'

// In Electron the preload bridge exists. In a plain browser (npm run dev:web) we mock it so the
// renderer can be developed and verified without the Electron binary. The mock simulates a
// playing track so the transport UI is exercisable; it produces no audio.
function mockBridge(): FlaconBridge {
  const prefersDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches
  let theme: ThemeSetting = 'system'
  const subs = new Set<(s: AppState) => void>()
  const snap = (): AppState => ({
    theme,
    resolvedTheme: theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme,
    platform: /Win/.test(navigator.platform) ? 'win32' : 'darwin'
  })

  let pb: PlaybackState = {
    ...initialPlayback,
    status: 'playing',
    outputRate: 96000,
    queueLength: 3,
    track: { path: '/mock/Undertow.flac', title: 'Undertow', durationSec: 380, sampleRate: 96000, channels: 2, bitDepth: 24, codec: 'flac' },
    positionSec: 112
  }
  const psubs = new Set<(s: PlaybackState) => void>()
  const setPb = (p: Partial<PlaybackState>): void => {
    pb = { ...pb, ...p }
    psubs.forEach((cb) => cb(pb))
  }
  setInterval(() => pb.status === 'playing' && setPb({ positionSec: pb.positionSec >= 380 ? 0 : pb.positionSec + 1 }), 1000)

  return {
    getState: async () => snap(),
    setTheme: async (t) => {
      theme = t
      subs.forEach((cb) => cb(snap()))
    },
    setIslandInteractive: () => {},
    onState: (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    getPlayback: async () => pb,
    sendPlayback: (c) => {
      if (c.type === 'toggle') setPb({ status: pb.status === 'playing' ? 'paused' : 'playing' })
      if (c.type === 'seek') setPb({ positionSec: c.seconds })
      if (c.type === 'volume') setPb({ volume: c.slider })
    },
    openFiles: async () => {},
    onPlayback: (cb) => {
      psubs.add(cb)
      return () => psubs.delete(cb)
    },
    libraryAlbums: async () => sampleAlbums,
    librarySearch: async (q) => {
      const fold = (x: string): string => x.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      const n = fold(q.trim())
      return n ? sampleAlbums.filter((a) => fold(`${a.title} ${a.artist}`).includes(n)) : sampleAlbums
    },
    libraryAddFolder: async () => {},
    libraryPlayAlbum: async () => {},
    getLibraryProgress: async () => ({ phase: 'idle', done: 0, total: 0, denied: [] }),
    onLibraryProgress: () => () => {},
    onLibraryChanged: () => () => {}
  }
}

export const bridge: FlaconBridge = window.flacon ?? mockBridge()
