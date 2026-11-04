import { app, shell, session, type BrowserWindow } from 'electron'

// Strict CSP. Dev needs 'unsafe-inline' styles for Vite HMR and ws: for its socket; prod is locked down.
export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    // Dev only: allow @vitejs/plugin-react's fast-refresh preamble (an inline script) by hash; packaged builds stay 'self'.
    dev ? `script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='` : `script-src 'self'`,
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

/**
 * Is this the URL of one of our own pages? IPC handlers refuse anything else, so even if a page were ever navigated
 * or framed somewhere unexpected it could not drive the main process. `rendererDir` is the file:// URL of the built
 * renderer folder; `devUrl` is the Vite origin when running unpackaged.
 */
export function isTrustedUrl(url: string, rendererDir: string, devUrl?: string): boolean {
  if (devUrl) {
    try {
      if (new URL(url).origin === new URL(devUrl).origin) return true
    } catch {
      /* fall through */
    }
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'file:') return false
  const base = rendererDir.endsWith('/') ? rendererDir : `${rendererDir}/`
  const normalized = u.href.split(/[?#]/)[0]!
  return normalized.startsWith(base) && !/\/\.\.?(\/|$)/.test(normalized.slice(base.length - 1)) && /\/(index|island|mini|engine)\.html$/.test(normalized)
}
