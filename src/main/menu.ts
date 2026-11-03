import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { ThemeSetting } from '@shared/ipc'
import type { PlaybackCommand, PlaybackState } from '@shared/playback'

// The native application menu. macOS shows it at the top of the screen (Flacon ▸ Settings… ⌘,);
// on Windows the title bar is custom, so the same accelerators work but the bar itself is not drawn.

export interface MenuDeps {
  send: (c: PlaybackCommand) => void
  /** Show the main window, then ask the UI to do something ("go:settings", "new-playlist"…). */
  ui: (action: string) => void
  addFolder: () => void
  openFiles: () => void
  importPlaylist: () => void
  checkForUpdates: () => void
  setTheme: (t: ThemeSetting) => void
  toggleIsland: () => void
  playback: () => PlaybackState
  theme: () => ThemeSetting
  islandOn: () => boolean
  lyricsOn: () => boolean
}

const isMac = process.platform === 'darwin'

export function buildMenu(d: MenuDeps): Menu {
  const pb = d.playback()
  const go = (label: string, key: string, action: string): MenuItemConstructorOptions => ({ label, accelerator: `CmdOrCtrl+${key}`, click: () => d.ui(action) })
  const theme = (label: string, t: ThemeSetting): MenuItemConstructorOptions => ({ label, type: 'radio', checked: d.theme() === t, click: () => d.setTheme(t) })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { label: 'Settings…', accelerator: 'Cmd+,', click: () => d.ui('go:settings') },
            { label: 'Check for Updates…', click: d.checkForUpdates },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Playlist', accelerator: 'CmdOrCtrl+N', click: () => d.ui('new-playlist') },
        { type: 'separator' },
        { label: 'Add Music Folder…', accelerator: 'Shift+CmdOrCtrl+O', click: d.addFolder },
        { label: 'Open Files…', accelerator: 'CmdOrCtrl+O', click: d.openFiles },
        { label: 'Import Playlist…', click: d.importPlaylist },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'close' as const }]
          : [{ type: 'separator' as const }, { label: 'Settings…', accelerator: 'Ctrl+,', click: () => d.ui('go:settings') }, { label: 'Check for Updates…', click: d.checkForUpdates }, { type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Playback',
      submenu: [
        { label: pb.status === 'playing' ? 'Pause' : 'Play', accelerator: 'CmdOrCtrl+Alt+P', click: () => d.send({ type: 'toggle' }), enabled: pb.queueLength > 0 },
        { label: 'Next', accelerator: 'CmdOrCtrl+Right', click: () => d.send({ type: 'next' }), enabled: pb.queueLength > 0 },
        { label: 'Previous', accelerator: 'CmdOrCtrl+Left', click: () => d.send({ type: 'prev' }), enabled: pb.queueLength > 0 },
        { type: 'separator' },
        { label: 'Shuffle', type: 'checkbox', checked: pb.shuffle, accelerator: 'CmdOrCtrl+Alt+S', click: () => d.send({ type: 'shuffle', on: !d.playback().shuffle }) },
        {
          label: 'Repeat',
          submenu: (['off', 'all', 'one'] as const).map((m) => ({ label: m === 'off' ? 'Off' : m === 'all' ? 'All' : 'One', type: 'radio' as const, checked: pb.repeat === m, click: () => d.send({ type: 'repeat', mode: m }) }))
        },
        { type: 'separator' },
        { label: 'Volume Up', accelerator: 'CmdOrCtrl+Up', click: () => d.send({ type: 'volume', slider: Math.min(1, d.playback().volume + 0.05) }) },
        { label: 'Volume Down', accelerator: 'CmdOrCtrl+Down', click: () => d.send({ type: 'volume', slider: Math.max(0, d.playback().volume - 0.05) }) },
        { type: 'separator' },
        { label: 'Show Queue', accelerator: 'CmdOrCtrl+Alt+U', click: () => d.ui('toggle-queue') },
        { label: 'Show Lyrics', type: 'checkbox', checked: d.lyricsOn(), accelerator: 'CmdOrCtrl+Alt+L', click: () => d.ui('toggle-lyrics') },
        { label: 'Equalizer', accelerator: 'CmdOrCtrl+Alt+E', click: () => d.ui('toggle-eq') }
      ]
    },
    {
      label: 'Go',
      submenu: [
        go('Tonight', '1', 'go:home'),
        go('Library', '2', 'go:library'),
        go('Playlists', '3', 'go:playlists'),
        go('Fetch', '4', 'go:fetch'),
        go('Listening', '5', 'go:stats'),
        { type: 'separator' },
        { label: 'Search Library', accelerator: 'CmdOrCtrl+F', click: () => d.ui('focus-search') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Appearance', submenu: [theme('Match System', 'system'), theme('Light', 'light'), theme('Dark', 'dark')] },
        { label: 'Flacon Island', type: 'checkbox', checked: d.islandOn(), accelerator: 'CmdOrCtrl+Alt+I', click: d.toggleIsland },
        { type: 'separator' },
        ...(app.isPackaged ? [] : [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }]),
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}

let lastKey = ''
/** Rebuild only when something the menu displays has changed (it is cheap, but the state echo is 10 Hz). */
export function refreshMenu(d: MenuDeps): void {
  const p = d.playback()
  const key = [p.status === 'playing', p.queueLength > 0, p.shuffle, p.repeat, d.theme(), d.islandOn(), d.lyricsOn()].join('|')
  if (key === lastKey) return
  lastKey = key
  Menu.setApplicationMenu(buildMenu(d))
}

export function forceMenu(d: MenuDeps): void {
  lastKey = ''
  refreshMenu(d)
}
