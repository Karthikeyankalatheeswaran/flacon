import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '@shared/channels'
import type { AppState, EngineBridge, FlaconBridge, ThemeSetting } from '@shared/ipc'
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
    emitState: (s: PlaybackState) => ipcRenderer.send(Channels.engineState, s)
  }
  contextBridge.exposeInMainWorld('flaconEngine', engine)
  // MessagePorts cannot cross contextBridge; hand the decoder port to the page via postMessage.
  ipcRenderer.on(Channels.decoderPort, (e) => window.postMessage('flacon-decoder-port', '*', [...e.ports]))
} else {
  const bridge: FlaconBridge = {
    getState: () => ipcRenderer.invoke(Channels.getState),
    setTheme: (t: ThemeSetting) => ipcRenderer.invoke(Channels.setTheme, t),
    setIslandInteractive: (v: boolean) => ipcRenderer.send(Channels.island, v),
    onState: (cb) => subscribe<AppState>(Channels.state, cb),
    getPlayback: () => ipcRenderer.invoke(Channels.getPlayback),
    sendPlayback: (c: PlaybackCommand) => ipcRenderer.send(Channels.playbackCommand, c),
    openFiles: () => ipcRenderer.invoke(Channels.openFiles),
    onPlayback: (cb) => subscribe<PlaybackState>(Channels.playbackState, cb)
  }
  contextBridge.exposeInMainWorld('flacon', bridge)
}
