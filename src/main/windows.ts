import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import { islandBounds, type IslandSpot } from './islandPlacement'
import { lockDown } from './security'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

const webPreferences = {
  preload: join(__dirname, '../preload/index.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
} as const

function load(win: BrowserWindow, page: 'index' | 'island'): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) void win.loadURL(`${dev}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

export function createMainWindow(opts: { bounds?: { x: number; y: number; width: number; height: number }; hidden?: boolean } = {}): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: opts.bounds?.width ?? 1280,
    height: opts.bounds?.height ?? 820,
    ...(opts.bounds ? { x: opts.bounds.x, y: opts.bounds.y } : {}),
    minWidth: 960,
    minHeight: 600,
    show: false,
    // Design shell: 52px title-bar band. mac uses inset traffic lights; Windows uses an overlay
    // whose height matches the 32px caption buttons, vertically centred in the 52px band.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 20, y: 20 } : undefined,
    titleBarOverlay: isWin ? { height: 52, color: '#00000000', symbolColor: dark ? '#EDEDE8' : '#141413' } : undefined,
    backgroundColor: dark ? '#0E0F12' : '#F4F1EA',
    ...(isMac ? {} : { icon: join(app.getAppPath(), 'build', 'icon.png') }),
    webPreferences
  })
  lockDown(win)
  // Launched at login: stay in the tray/island until the user asks for the window.
  win.once('ready-to-show', () => !opts.hidden && win.show())
  // Closing hides: audio keeps playing from the engine window (milestone 2).
  win.on('close', (e) => {
    if (!(globalThis as { __flaconQuitting?: boolean }).__flaconQuitting) {
      e.preventDefault()
      win.hide()
    }
  })
  load(win, 'index')
  return win
}

/** Put the island on the display under the cursor, at one of the six spots (top/bottom × left/centre/right). */
export function placeIsland(win: BrowserWindow, spot: IslandSpot): void {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds(islandBounds(d, process.platform, spot.edge, spot.align))
}

export function createIslandWindow(spot: () => IslandSpot = () => ({ edge: 'top', align: 'center' })): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const win = new BrowserWindow({
    ...islandBounds(display, process.platform, spot().edge, spot().align),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    skipTaskbar: true,
    focusable: false, // never steals focus; never in Alt-Tab
    alwaysOnTop: true,
    type: isMac ? 'panel' : undefined,
    webPreferences
  })
  win.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver')
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Transparent area is click-through; the renderer turns this off while over the pill.
  win.setIgnoreMouseEvents(true, { forward: true })
  lockDown(win)
  win.once('ready-to-show', () => win.showInactive())
  load(win, 'island')

  const replace = (): void => placeIsland(win, spot())
  screen.on('display-added', replace)
  screen.on('display-removed', replace)
  screen.on('display-metrics-changed', replace)
  win.on('closed', () => {
    screen.removeListener('display-added', replace)
    screen.removeListener('display-removed', replace)
    screen.removeListener('display-metrics-changed', replace)
  })
  return win
}
