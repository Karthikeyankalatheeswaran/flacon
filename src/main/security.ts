import { app, shell, session, type BrowserWindow } from 'electron'

// Strict CSP. Dev needs 'unsafe-inline' styles for Vite HMR and ws: for its socket; prod is locked down.
export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self'`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob: flacon-art:",
    "font-src 'self'",
    "media-src 'self' blob:", // engine's silent <audio> (media-session keepalive)
    "worker-src 'self' blob:",
    dev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
}

const EXTERNAL_ALLOWED = new Set(['https:', 'mailto:'])

export function openExternalSafe(raw: string): void {
  try {
    const u = new URL(raw)
    if (EXTERNAL_ALLOWED.has(u.protocol)) void shell.openExternal(u.toString())
  } catch {
    /* malformed URL: ignore */
  }
}

/** Disable navigation and new windows in every renderer; external links go through the allowlist. */
export function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (!(dev && url.startsWith(dev))) e.preventDefault()
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
}

export function installCsp(): void {
  const dev = !app.isPackaged
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy(dev)] } })
  })
  // Deny every permission request: Flacon needs none until the audio engine lands (and that is local).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}
