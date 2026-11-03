import type { UpdateStatus } from '@shared/update'
import type { FetchJob } from '@shared/fetch'
import type { FetchSettings } from '@shared/fetchIpc'
import type { AppSettingsInfo, AppState, FlaconBridge, ThemeSetting } from '@shared/ipc'
import { sampleAlbums, type LibrarySong, type SongsQuery } from '@shared/library'
import { initialPlayback, type PlaybackState } from '@shared/playback'

// In Electron the preload bridge exists. In a plain browser (npm run dev:web) we mock it so the
// renderer can be developed and verified without the Electron binary. The mock simulates a
// playing track so the transport UI is exercisable; it produces no audio.
// 5 000 synthetic songs (more with ?songs=100000) so virtualization and sorting can be exercised without a real library.
const mockSongs: LibrarySong[] = Array.from({ length: Math.min(500_000, Number(new URLSearchParams(location.search).get('songs')) || 5000) }, (_, i) => {
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
    libraryFolder: async (dir) => dir === null
      ? { dir, dirs: mockFolders.map((p) => ({ name: p, path: p, tracks: 120 })), tracks: [] }
      : { dir, dirs: dir.split('/').length < 6 ? [{ name: 'Night Album', path: `${dir}/Night Album`, tracks: 2 }] : [], tracks: dir.endsWith('Night Album') ? [{ id: 1, path: `${dir}/01 Moth.flac`, title: 'Moth', artist: 'Zed', durationSec: 212 }, { id: 2, path: `${dir}/02 Lantern.flac`, title: 'Lantern', artist: 'Zed', durationSec: 187 }] : [] },
    libraryPlayFolder: async () => {},
    getLibraryProgress: async () => ({ phase: 'idle', done: 0, total: 0, denied: [] }),
    onLibraryProgress: () => () => {},
    onLibraryChanged: () => () => {},
    libraryFolders: async () => [...mockFolders],
    libraryRemoveFolder: async (p) => void mockFolders.splice(mockFolders.indexOf(p), 1),
    getUpdate: async () => mockUpdate,
    onUpdate: (cb) => (updateSubs.add(cb), () => updateSubs.delete(cb)),
    updateAction: (op) => {
      const set = (u: UpdateStatus): void => { mockUpdate = u; updateSubs.forEach((cb) => cb(u)) }
      if (op === 'check') { set({ state: 'checking' }); setTimeout(() => set({ state: 'available', version: '0.2.0' }), 900) }
      if (op === 'download') { set({ state: 'downloading', version: '0.2.0', percent: 0 }); let p = 0; const t = setInterval(() => { p += 20; if (p >= 100) { clearInterval(t); set({ state: 'ready', version: '0.2.0' }) } else set({ state: 'downloading', version: '0.2.0', percent: p }) }, 300) }
    },
    getSettings: async () => ({ ...mockSettings }),
    setSettings: async (patch) => ({ ...Object.assign(mockSettings, patch) }),
    ...mockFetch()
  }
}

export const bridge: FlaconBridge = window.flacon ?? mockBridge()


let mockUpdate: UpdateStatus = { state: 'idle' }
const updateSubs = new Set<(s: UpdateStatus) => void>()
const mockFolders = ['/Users/you/Music/Flacon', '/Volumes/Archive/Lossless']
const mockSettings: AppSettingsInfo = { launchAtLogin: false, pauseOnSuspend: true, updateChecks: true, islandEdge: 'top', onboarded: false, recovered: false, canLaunchAtLogin: true, platform: 'darwin' }

// Browser-preview stand-in for the fetcher: canned search results and a job that walks through every state.
function mockFetch(): Pick<FlaconBridge, 'fetchSearch' | 'fetchEnqueue' | 'fetchControl' | 'fetchGet' | 'onFetch' | 'fetchSettings' | 'fetchSetSettings'> {
  let jobs: FetchJob[] = []
  let settings: FetchSettings = { jamendoClientId: '', watchDownloads: false }
  const subs = new Set<(j: FetchJob[]) => void>()
  const emit = (): void => subs.forEach((cb) => cb(jobs.map((j) => ({ ...j }))))
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const cc = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'Attribution required' }
  const walk = async (j: FetchJob, fail: boolean): Promise<void> => {
    const st = (): FetchJob['status'] => j.status
    j.status = 'downloading'
    for (let i = 1; i <= 10; i++) {
      await sleep(250)
      if (st() === 'canceled') return
      while (st() === 'paused') await sleep(200)
      j.received = (j.total * i) / 10
      if (fail && i === 6) { j.status = 'failed'; j.error = 'The server refused the download (403).'; return emit() }
      emit()
    }
    j.status = 'verifying'; emit(); await sleep(700)
    j.status = 'importing'; emit(); await sleep(500)
    j.status = 'done'
    j.notes = j.item.title.includes('Upscaled') ? ['Claims 24/96: content ends near 16.0 kHz, like a 16 kHz lossy source.'] : []
    emit()
  }
  return {
    fetchSearch: async ({ provider, query }) => {
      await sleep(400)
      if (/offline/i.test(query)) return { ok: false, error: 'Couldn’t reach the server. Check your connection and try again.' }
      if (provider === 'jamendo') return { ok: false, error: 'Add your Jamendo client ID in Settings to search Jamendo.' }
      if (provider === 'link') return /^https:\/\//.test(query) ? { ok: true, results: [{ provider, id: query, title: decodeURIComponent(query.split('/').pop() || 'download'), artist: new URL(query).hostname }] } : { ok: false, error: 'That doesn’t look like a link.' }
      if (/nothing|empty/i.test(query)) return { ok: true, results: [] }
      return { ok: true, results: [
        { provider, id: 'night-garden', title: 'Night Garden Sessions', artist: 'Moth Quartet', license: cc },
        { provider, id: 'harbour-lights', title: 'Harbour Lights (Live 1974)', artist: 'The Pilots', license: { name: 'Public Domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/' } },
        { provider, id: 'upscaled-demo', title: 'Upscaled Demo', artist: 'Tape Hiss', license: { name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } }
      ] }
    },
    fetchEnqueue: async ({ provider, id }) => {
      const mk = (title: string, size: number): FetchJob => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: 'queued', received: 0, total: size, attempt: 0, retryAt: 0, error: null, notes: [], createdAt: Date.now(),
        item: { provider, title, artist: '', album: id, url: `https://example.org/${id}`, format: 'flac', size, license: cc } })
      const made = id === 'upscaled-demo' ? [mk('Upscaled Demo', 41e6)] : id === 'link' ? [mk(id, 30e6)] : [mk('01 Moth Song', 38e6), mk('02 Lantern', 52e6)]
      jobs.push(...made); emit()
      made.forEach((j, i) => void walk(j, id === 'harbour-lights' && i === 0))
      return { ok: true, count: made.length }
    },
    fetchControl: ({ op, id }) => {
      if (op === 'clear') jobs = jobs.filter((j) => !['done', 'failed', 'canceled'].includes(j.status))
      const j = jobs.find((x) => x.id === id)
      if (j && op === 'pause') j.status = 'paused'
      if (j && op === 'resume') { j.status = 'downloading'; j.error = null }
      if (j && op === 'cancel') j.status = 'canceled'
      emit()
    },
    fetchGet: async () => jobs,
    onFetch: (cb) => { subs.add(cb); return () => subs.delete(cb) },
    fetchSettings: async () => settings,
    fetchSetSettings: async (s) => (settings = s)
  }
}
