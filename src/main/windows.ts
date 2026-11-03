import { join } from 'node:path'
import { BrowserWindow, nativeTheme, screen } from 'electron'
import { islandBounds } from './islandPlacement'
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

export function createMainWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // Design shell: 52px title-bar band. mac uses inset traffic lights; Windows uses an overlay
    // whose height matches the 32px caption buttons, vertically centred in the 52px band.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 20, y: 20 } : undefined,
    titleBarOverlay: isWin ? { height: 52, color: '#00000000', symbolColor: dark ? '#EDEDE8' : '#141413' } : undefined,
    backgroundColor: dark ? '#111211' : '#F2F2EF',
    webPreferences
  })
  lockDown(win)
  win.once('ready-to-show', () => win.show())
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

export function createIslandWindow(): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const win = new BrowserWindow({
    ...islandBounds(display, process.platform),
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

  const replace = (): void => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win.setBounds(islandBounds(d, process.platform))
  }
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
