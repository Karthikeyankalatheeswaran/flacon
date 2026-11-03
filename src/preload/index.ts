import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '@shared/channels'
import type { UpdateStatus } from '@shared/update'
import type { FetchJob } from '@shared/fetch'
import type { FetchSettings } from '@shared/fetchIpc'
import type { AppSettingsInfo, AppState, EngineBridge, FlaconBridge, QueueSnapshot, ThemeSetting } from '@shared/ipc'
import type { AnalysisProgress, Album, LibraryProgress, SongsPage, SongsQuery } from '@shared/library'
import type { PlaybackCommand, PlaybackState } from '@shared/playback'

// One preload for every window (sandboxed preloads cannot require sibling chunks). Each page only
// receives the surface it needs: the hidden engine page gets the engine bridge, UI pages get the UI bridge.

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

if (location.pathname.endsWith('/engine.html')) {
  const engine: EngineBridge = {
    onCommand: (cb) => subscribe<PlaybackCommand | { type: 'resume-context' }>(Channels.engineCommand, cb),
    emitState: (s: PlaybackState) => ipcRenderer.send(Channels.engineState, s),
    emitQueue: (paths: string[], index: number) => ipcRenderer.send(Channels.engineQueue, { paths, index })
  }
  contextBridge.exposeInMainWorld('flaconEngine', engine)
  // MessagePorts cannot cross contextBridge; hand the decoder port to the page via postMessage.
  ipcRenderer.on(Channels.decoderPort, (e) => window.postMessage('flacon-decoder-port', '*', [...e.ports]))
} else {
  const bridge: FlaconBridge = {
    getState: () => ipcRenderer.invoke(Channels.getState),
    setTheme: (t: ThemeSetting) => ipcRenderer.invoke(Channels.setTheme, t),
    showMain: () => ipcRenderer.send(Channels.showMain),
    setIslandInteractive: (v: boolean) => ipcRenderer.send(Channels.island, v),
    onState: (cb) => subscribe<AppState>(Channels.state, cb),
    getPlayback: () => ipcRenderer.invoke(Channels.getPlayback),
    sendPlayback: (c: PlaybackCommand) => ipcRenderer.send(Channels.playbackCommand, c),
    openFiles: () => ipcRenderer.invoke(Channels.openFiles),
    onPlayback: (cb) => subscribe<PlaybackState>(Channels.playbackState, cb),
    libraryAlbums: (): Promise<Album[]> => ipcRenderer.invoke(Channels.libraryAlbums),
    librarySearch: (q: string): Promise<Album[]> => ipcRenderer.invoke(Channels.librarySearch, q),
    librarySongs: (q: SongsQuery): Promise<SongsPage> => ipcRenderer.invoke(Channels.librarySongs, q),
    libraryFolder: (dir: string | null) => ipcRenderer.invoke(Channels.libraryFolder, dir),
    libraryPlayFolder: (dir: string, index: number) => ipcRenderer.invoke(Channels.libraryPlayFolder, { dir, index }),
    libraryAddFolder: () => ipcRenderer.invoke(Channels.libraryAddFolder),
    libraryPlayAlbum: (id: string) => ipcRenderer.invoke(Channels.libraryPlayAlbum, id),
    libraryFolders: (): Promise<string[]> => ipcRenderer.invoke(Channels.libraryFolders),
    libraryRemoveFolder: (p: string) => ipcRenderer.invoke(Channels.libraryRemoveFolder, p),
    getUpdate: () => ipcRenderer.invoke(Channels.updateGet),
    onUpdate: (cb) => subscribe<UpdateStatus>(Channels.updateState, cb),
    updateAction: (op) => ipcRenderer.send(Channels.updateAction, op),
    getSettings: () => ipcRenderer.invoke(Channels.settingsGet),
    setSettings: (patch) => ipcRenderer.invoke(Channels.settingsSet, patch),
    onSettings: (cb) => subscribe<AppSettingsInfo>(Channels.settingsChanged, cb),
    getLibraryProgress: (): Promise<LibraryProgress> => ipcRenderer.invoke(Channels.libraryGetProgress),
    onLibraryProgress: (cb) => subscribe<LibraryProgress>(Channels.libraryProgress, cb),
    onLibraryChanged: (cb) => subscribe<null>(Channels.libraryChanged, () => cb()),
    libraryCall: (req) => ipcRenderer.invoke(Channels.libraryCall, req),
    libraryPlay: (req) => ipcRenderer.invoke(Channels.libraryPlay, req),
    getQueue: (): Promise<QueueSnapshot> => ipcRenderer.invoke(Channels.getQueue),
    onQueue: (cb) => subscribe<QueueSnapshot>(Channels.queue, cb),
    onLibraryActivity: (cb) => subscribe<null>(Channels.libraryActivity, () => cb()),
    onAnalysis: (cb) => subscribe<AnalysisProgress>(Channels.libraryAnalysis, cb),
    onMenuAction: (cb) => subscribe<string>(Channels.menuAction, cb),
    playlistIo: (req) => ipcRenderer.invoke(Channels.playlistIo, req),
    reveal: (p: string) => ipcRenderer.send(Channels.reveal, p),
    fetchSearch: (q) => ipcRenderer.invoke(Channels.fetchSearch, q),
    fetchEnqueue: (p) => ipcRenderer.invoke(Channels.fetchEnqueue, p),
    fetchControl: (c) => ipcRenderer.send(Channels.fetchControl, c),
    fetchGet: (): Promise<FetchJob[]> => ipcRenderer.invoke(Channels.fetchGet),
    onFetch: (cb) => subscribe<FetchJob[]>(Channels.fetchState, cb),
    fetchSettings: (): Promise<FetchSettings> => ipcRenderer.invoke(Channels.fetchSettingsGet),
    fetchSetSettings: (s: FetchSettings): Promise<FetchSettings> => ipcRenderer.invoke(Channels.fetchSettingsSet, s)
  }
  contextBridge.exposeInMainWorld('flacon', bridge)
}
