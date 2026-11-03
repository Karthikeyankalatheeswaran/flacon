import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import type { PlaybackCommand, PlaybackState } from '@shared/playback'
import { TRAY_ICON_PNG_BASE64 } from './trayIcon'

// Tray (Windows) / menu-bar extra (macOS): now-playing row, transport, Show Flacon, Quit.
// Also the macOS Dock menu and the Windows taskbar thumbnail toolbar.

let tray: Tray | null = null

interface Deps {
  send: (c: PlaybackCommand) => void
  showMain: () => void
  quit: () => void
}

function icon(): Electron.NativeImage {
  const img = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'), { scaleFactor: 2 })
  img.setTemplateImage(true) // macOS tints it for light/dark menu bars
  return img
}

function menuFor(s: PlaybackState, d: Deps): Menu {
  const playing = s.status === 'playing'
  const label = s.track ? `${s.track.title}` : 'Nothing playing'
  return Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    { label: playing ? 'Pause' : 'Play', click: () => d.send({ type: 'toggle' }), enabled: s.queueLength > 0 },
    { label: 'Next', click: () => d.send({ type: 'next' }), enabled: s.queueIndex + 1 < s.queueLength },
    { label: 'Previous', click: () => d.send({ type: 'prev' }), enabled: s.queueLength > 0 },
    { type: 'separator' },
    { label: 'Show Flacon', click: d.showMain },
    { label: 'Quit Flacon', click: d.quit }
  ])
}

export function createTray(initial: PlaybackState, d: Deps): void {
  tray = new Tray(icon())
  tray.setToolTip('Flacon')
  tray.setContextMenu(menuFor(initial, d))
  tray.on('click', () => process.platform === 'win32' && d.showMain())
  if (process.platform === 'darwin') app.dock?.setMenu(menuFor(initial, d))
}

export function updateTray(s: PlaybackState, d: Deps, main: BrowserWindow | null): void {
  tray?.setContextMenu(menuFor(s, d))
  tray?.setToolTip(s.track ? `Flacon — ${s.track.title}` : 'Flacon')
  if (process.platform === 'darwin') app.dock?.setMenu(menuFor(s, d))
  if (process.platform === 'win32' && main && !main.isDestroyed()) {
    // Thumbnail toolbar needs icons; text-only fallback is not supported, so use tiny glyphs.
    const g = (path: string): Electron.NativeImage => nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='${path}' fill='white'/></svg>`)}`)
    main.setThumbarButtons([
      { tooltip: 'Previous', icon: g('M12 3v10L5 8zM4 3h1.5v10H4z'), click: () => d.send({ type: 'prev' }) },
      { tooltip: s.status === 'playing' ? 'Pause' : 'Play', icon: g(s.status === 'playing' ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M4 2.5v11l9-5.5z'), click: () => d.send({ type: 'toggle' }) },
      { tooltip: 'Next', icon: g('M4 3v10l7-5zM12.5 3H14v10h-1.5z'), click: () => d.send({ type: 'next' }) }
    ])
  }
}
