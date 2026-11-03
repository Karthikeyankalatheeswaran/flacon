import type { AppState, FlaconBridge, ThemeSetting } from '@shared/ipc'
import { sampleAlbums, type LibrarySong, type SongsQuery } from '@shared/library'
import { initialPlayback, type PlaybackState } from '@shared/playback'

// In Electron the preload bridge exists. In a plain browser (npm run dev:web) we mock it so the
// renderer can be developed and verified without the Electron binary. The mock simulates a
// playing track so the transport UI is exercisable; it produces no audio.
// 5 000 synthetic songs so virtualization and sorting can be exercised without a real library.
const mockSongs: LibrarySong[] = Array.from({ length: 5000 }, (_, i) => {
  const a = sampleAlbums[i % sampleAlbums.length]!
  return {
    id: i + 1, path: `/mock/${i}.flac`, title: `${['Glass Harbour', 'Undertow', 'Pilot Light', 'Hush', 'Shoreline'][i % 5]} ${Math.floor(i / 5) + 1}`, artist: a.artist, album: a.title,
    durationSec: i === 3 ? 11528 : i === 2 ? 4 : 120 + ((i * 37) % 300), quality: a.quality, sampleRate: a.quality === 'hires' ? 96000 : 44100,
    bitDepth: a.quality === 'hires' ? 24 : a.quality === 'lossy' ? null : 16, codec: a.quality === 'lossy' ? 'aac' : 'flac', offline: !!a.offline, sleeve: a.sleeve, duplicate: i % 97 === 0
  }
})

function mockSongsPage(q: SongsQuery): { total: number; rows: LibrarySong[] } {
  const fold = (x: string): string => x.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  const n = fold(q.text.trim())
  const rows = n ? mockSongs.filter((s) => fold(`${s.title} ${s.artist} ${s.album}`).includes(n)) : [...mockSongs]
  const key = (s: LibrarySong): string | number => (q.sort === 'duration' ? s.durationSec : q.sort === 'added' ? s.id : q.sort === 'quality' ? ({ hires: 2, cd: 1, upscaled: 1, lossy: 0 })[s.quality] : fold(s[q.sort]))
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (q.dir === 'asc' ? 1 : -1))
  return { total: rows.length, rows: rows.slice(q.offset, q.offset + q.limit) }
}

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
      if (c.type === 'eq') setPb({ eq: c.eq })
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
    librarySongs: async (q) => mockSongsPage(q),
    libraryAddFolder: async () => {},
    libraryPlayAlbum: async () => {},
    getLibraryProgress: async () => ({ phase: 'idle', done: 0, total: 0, denied: [] }),
    onLibraryProgress: () => () => {},
    onLibraryChanged: () => () => {}
  }
}

export const bridge: FlaconBridge = window.flacon ?? mockBridge()
