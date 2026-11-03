import type { UpdateStatus } from '@shared/update'
import type { FetchJob } from '@shared/fetch'
import type { FetchSettings } from '@shared/fetchIpc'
import type { AppSettingsInfo, AppState, FlaconBridge, QueueItem, QueueSnapshot, ThemeSetting } from '@shared/ipc'
import { sampleAlbums, type HomeData, type LibrarySong, type Lyrics, type Playlist, type SongsQuery, type StatsData } from '@shared/library'
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
    bitDepth: a.quality === 'hires' ? 24 : a.quality === 'lossy' ? null : 16, codec: a.quality === 'lossy' ? 'aac' : 'flac', offline: !!a.offline, sleeve: a.sleeve, duplicate: i % 97 === 0,
    artUrl: null, lossless: a.quality !== 'lossy', purity: a.quality === 'lossy' ? null : i % 11 === 0 ? 68 : i % 7 === 0 ? 88 : i % 5 === 0 ? null : 100,
    ceilingKhz: a.quality === 'lossy' ? null : i % 11 === 0 ? 16 : 22.05, effBits: a.quality === 'lossy' ? null : a.quality === 'hires' ? 24 : 16, upscaled: i % 11 === 0 && a.quality !== 'lossy',
    favorite: i % 6 === 0, rating: 0, playCount: (i * 7) % 23, lastPlayed: i % 3 ? 0 : 1_700_000_000 - i * 3600, addedAt: 1_690_000_000 + i * 60, gainDb: null, peak: null
  }
})

function mockSongsPage(q: SongsQuery): { total: number; rows: LibrarySong[] } {
  const fold = (x: string): string => x.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  const n = fold(q.text.trim())
  const sc = q.scope ?? 'all'
  const inScope = (s: LibrarySong): boolean => sc === 'favorites' ? s.favorite : sc === 'verified' ? (s.purity ?? 0) >= 95 : sc === 'upscaled' ? s.upscaled : sc === 'played' ? s.playCount > 0 : sc === 'recent' ? s.lastPlayed > 0 : sc.startsWith('playlist:') ? s.id % 9 === 0 : true
  const rows = mockSongs.filter((s) => inScope(s) && (!n || fold(`${s.title} ${s.artist} ${s.album}`).includes(n)))
  const key = (s: LibrarySong): string | number => (q.sort === 'duration' ? s.durationSec : q.sort === 'purity' ? s.purity ?? -1 : q.sort === 'plays' ? s.playCount : q.sort === 'lastPlayed' ? s.lastPlayed : q.sort === 'rating' ? s.rating : q.sort === 'position' ? s.id : q.sort === 'added' ? s.id : q.sort === 'quality' ? ({ hires: 2, cd: 1, upscaled: 1, lossy: 0 })[s.quality] : fold(String(s[q.sort as 'title' | 'artist' | 'album'])))
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
    showMain: () => {},
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
    setSettings: async (patch) => {
      Object.assign(mockSettings, patch)
      settingsSubs.forEach((cb) => cb({ ...mockSettings }))
      return { ...mockSettings }
    },
    onSettings: (cb) => (settingsSubs.add(cb), () => settingsSubs.delete(cb)),
    libraryCall: (async (req: { op: string; [k: string]: unknown }) => mockCall(req)) as FlaconBridge['libraryCall'],
    libraryPlay: async () => {},
    getQueue: async () => mockQueue,
    onQueue: () => () => {},
    onLibraryActivity: (cb) => (activitySubs.add(cb), () => activitySubs.delete(cb)),
    onAnalysis: () => () => {},
    onMenuAction: () => () => {},
    playlistIo: async () => ({ ok: true, message: 'Not available in the browser preview.' }),
    reveal: () => {},
    ...mockFetch()
  }
}

export const bridge: FlaconBridge = window.flacon ?? mockBridge()


let mockUpdate: UpdateStatus = { state: 'idle' }
const updateSubs = new Set<(s: UpdateStatus) => void>()
const mockFolders = ['/Users/you/Music/Flacon', '/Volumes/Archive/Lossless']
const mockSettings: AppSettingsInfo = { launchAtLogin: false, pauseOnSuspend: true, updateChecks: true, islandEdge: 'top', onboarded: false, islandEnabled: true, islandMode: 'always', islandSize: 'comfortable', islandArt: true, islandBadge: true, replayGain: 'off', crossfade: 0, showLyrics: false, recovered: false, canLaunchAtLogin: true, platform: 'darwin' }
const settingsSubs = new Set<(s: AppSettingsInfo) => void>()
const activitySubs = new Set<() => void>()

const slim = (s: LibrarySong): QueueItem => ({ path: s.path, title: s.title, artist: s.artist, album: s.album, durationSec: s.durationSec, artUrl: s.artUrl, purity: s.purity, lossless: s.lossless, favorite: s.favorite, upscaled: s.upscaled })
const mockQueue: QueueSnapshot = { rev: 1, items: mockSongs.slice(0, 8).map(slim) }
let mockPlaylists: Playlist[] = [{ id: 1, name: 'Night drive', tracks: 12, minutes: 48, sleeve: sampleAlbums[0]!.sleeve, updatedAt: 1_700_000_000 }, { id: 2, name: 'Quiet hours', tracks: 7, minutes: 31, sleeve: sampleAlbums[1]!.sleeve, updatedAt: 1_700_000_100 }]
const mockLyrics: Lyrics = { synced: true, source: 'sidecar', lines: Array.from({ length: 14 }, (_, i) => ({ t: i * 9, text: ['Glass on the harbour', 'Holding the light', 'Every wave a measured thing', 'Nothing here is padded', 'Nothing here is lost', 'Pilot light, pilot light', 'Carry me home'][i % 7]! })) }

function mockCall(req: { op: string; [k: string]: unknown }): unknown {
  switch (req.op) {
    case 'setFavorite': { const s = mockSongs.find((x) => x.path === req.path); if (s) s.favorite = !!req.value; activitySubs.forEach((cb) => cb()); return null }
    case 'playlists': return mockPlaylists
    case 'playlistCreate': { const id = Math.max(0, ...mockPlaylists.map((p) => p.id)) + 1; mockPlaylists = [...mockPlaylists, { id, name: String(req.name || 'New playlist'), tracks: (req.paths as string[]).length, minutes: 0, sleeve: sampleAlbums[0]!.sleeve, updatedAt: Date.now() }]; activitySubs.forEach((cb) => cb()); return id }
    case 'playlistRename': mockPlaylists = mockPlaylists.map((p) => (p.id === req.id ? { ...p, name: String(req.name) } : p)); return null
    case 'playlistDelete': mockPlaylists = mockPlaylists.filter((p) => p.id !== req.id); return null
    case 'lyrics': return mockLyrics
    case 'home': return mockHome()
    case 'stats': return mockStats
    case 'analysisProgress': return { done: 0, total: 0 }
    case 'trackMetas': return []
    default: return null
  }
}

function mockHome(): HomeData {
  return { jumpBackIn: sampleAlbums.slice(0, 6), recentlyAdded: sampleAlbums.slice(2), onRepeat: mockSongs.filter((s) => s.playCount > 18).slice(0, 5), forgotten: mockSongs.filter((s) => s.favorite).slice(0, 5), review: { upscaled: 3, measured: 40, total: 60, avgPurity: 94 } }
}
const mockStats: StatsData = {
  songs: 5000, albums: sampleAlbums.length, artists: 6, hoursOfMusic: 342, plays: 812, hoursListened: 57,
  topArtists: sampleAlbums.slice(0, 5).map((a, i) => ({ name: a.artist, plays: 90 - i * 13 })),
  topSongs: mockSongs.slice(0, 5).map((s, i) => ({ title: s.title, artist: s.artist, plays: 40 - i * 6, path: s.path })),
  topAlbums: sampleAlbums.slice(0, 5).map((a, i) => ({ title: a.title, artist: a.artist, plays: 70 - i * 9 })),
  byWeekday: [40, 55, 62, 48, 70, 120, 90], byHour: Array.from({ length: 24 }, (_, h) => (h > 17 && h < 24 ? 30 + h : h > 7 && h < 12 ? 20 : 4)),
  purity: { pure: 2100, good: 900, limited: 300, thin: 100, lossy: 400, unmeasured: 1200 }, measured: 3400, lossless: 4600
}

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
