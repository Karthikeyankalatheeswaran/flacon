import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Playlists, favourites, queue, shuffle/repeat, purity measuring, the native menu and the island settings, driven through the real app.
const root = mkdtempSync(join(tmpdir(), 'flacon-feat-'))
const lib = join(root, 'music')
afterAll(() => rmSync(root, { recursive: true, force: true }))

const noise = (file: string, lowpassHz: number | null, title: string): void =>
  void execFileSync(ffmpegPath as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=40:c=white:r=44100:a=0.3', ...(lowpassHz ? ['-af', Array.from({ length: 10 }, () => `lowpass=f=${lowpassHz}:poles=2`).join(',')] : []), '-sample_fmt', 's16', '-metadata', `title=${title}`, '-metadata', 'artist=Hiss', '-metadata', 'album=Purity', file])

type Song = { path: string; title: string; purity: number | null; favorite: boolean; upscaled: boolean; lossless: boolean }
type Api = { librarySongs(q: unknown): Promise<{ total: number; rows: Song[] }>; libraryCall<T>(r: unknown): Promise<T>; libraryPlay(r: unknown): Promise<void>; getQueue(): Promise<{ items: Array<{ title: string }> }>; getPlayback(): Promise<{ shuffle: boolean; repeat: string; status: string }>; sendPlayback(c: unknown): void; setSettings(p: unknown): Promise<unknown> }
const call = <T>(p: Page, fn: (f: Api) => Promise<T>): Promise<T> => p.evaluate(`(${fn.toString()})(window.flacon)`) as Promise<T>
const until = async <T>(f: () => Promise<T | false | undefined>, ms = 40_000): Promise<T> => {
  const t = Date.now()
  for (;;) {
    const v = await f().catch(() => undefined)
    if (v) return v
    if (Date.now() - t > ms) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 250))
  }
}
const all = (p: Page, scope = 'all'): Promise<Song[]> => p.evaluate(`window.flacon.librarySongs({ sort: 'title', dir: 'asc', text: '', scope: ${JSON.stringify(scope)}, offset: 0, limit: 50 }).then((r) => r.rows)`) as Promise<Song[]>

let app: ElectronApplication
let page: Page

beforeAll(async () => {
  mkdirSync(join(lib, 'Purity'), { recursive: true })
  noise(join(lib, 'Purity', '01 Full band.flac'), null, 'Full band')
  noise(join(lib, 'Purity', '02 Padded.flac'), 16000, 'Padded')
  app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'ud')}`], env: { ...process.env, FLACON_LIBRARY_FOLDER: lib } as Record<string, string>, timeout: 45_000 })
  for (let i = 0; i < 100 && !app.windows().some((w) => w.url().endsWith('/index.html')); i++) await new Promise((r) => setTimeout(r, 200))
  page = app.windows().find((w) => w.url().endsWith('/index.html'))!
  await page.waitForLoadState('domcontentloaded')
  // First-run welcome sheet covers the app until dismissed.
  await page.getByRole('dialog', { name: /welcome/i }).waitFor({ timeout: 15_000 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
  await page.getByRole('dialog', { name: /welcome/i }).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
}, 90_000)
afterAll(async () => void (await app?.close().catch(() => undefined)))

describe('features', () => {
  it('crossfades into the next track: with 6 s on, the hand-over comes ~6 s before the old track ends', async () => {
    const songs = await all(page)
    await call(page, (f) => f.setSettings({ crossfade: 6 }))
    await page.evaluate(`window.flacon.libraryPlay({ source: { kind: 'paths', paths: ${JSON.stringify(songs.map((x) => x.path))} }, mode: 'play', index: 0 })`)
    await until(async () => (await call(page, (f) => f.getPlayback())).status === 'playing')
    await call(page, async (f) => f.sendPlayback({ type: 'repeat', mode: 'off' }))
    await call(page, async (f) => f.sendPlayback({ type: 'shuffle', on: false }))
    await call(page, async (f) => f.sendPlayback({ type: 'seek', seconds: 26 }))
    const t0 = Date.now()
    const next = await until(async () => { const x = (await page.evaluate('window.flacon.getPlayback()')) as { queueIndex: number; status: string; positionSec: number }; return x.queueIndex === 1 && x }, 20_000)
    const took = (Date.now() - t0) / 1000
    // Measured: ~10.3 s with crossfade off, ~5.1 s with 6 s on. 7.5 s separates them with slack.
    expect(took).toBeLessThan(7.5)
    expect(next.status).toBe('playing')
    await new Promise((r) => setTimeout(r, 7500))
    const after = (await page.evaluate('window.flacon.getPlayback()')) as { status: string; positionSec: number; queueIndex: number }
    expect(after.status).toBe('playing')
    expect(after.queueIndex).toBe(1)
    expect(after.positionSec).toBeGreaterThan(5) // the new track kept playing past the fade, no stall
    await call(page, (f) => f.setSettings({ crossfade: 0 }))
  }, 60_000)

  it('measures purity in the background: full-band is pure, a 16 kHz lowpass is flagged', async () => {
    const rows = await until(async () => { const r = await all(page); return r.length === 2 && r.every((s) => s.purity !== null) && r })
    const full = rows.find((r) => r.title === 'Full band')!
    const padded = rows.find((r) => r.title === 'Padded')!
    expect(full.purity).toBeGreaterThanOrEqual(95)
    expect(full.upscaled).toBe(false)
    expect(padded.purity!).toBeLessThan(90)
    expect(padded.purity!).toBeLessThan(full.purity! - 10)
  })

  it('favourites show up in the Favourites blend', async () => {
    const [first] = await all(page)
    await page.evaluate(`window.flacon.libraryCall({ op: 'setFavorite', path: ${JSON.stringify(first!.path)}, value: true })`)
    const fav = await until(async () => { const r = await all(page, 'favorites'); return r.length === 1 && r })
    expect(fav[0]!.path).toBe(first!.path)
  })

  it('creates a playlist, adds, removes and keeps order', async () => {
    const songs = await all(page)
    const id = (await page.evaluate(`window.flacon.libraryCall({ op: 'playlistCreate', name: 'Test list', paths: ${JSON.stringify(songs.map((s) => s.path))} })`)) as number
    expect(await all(page, `playlist:${id}`)).toHaveLength(2)
    await page.evaluate(`window.flacon.libraryCall({ op: 'playlistRemove', id: ${id}, positions: [0] })`)
    expect(await all(page, `playlist:${id}`)).toHaveLength(1)
    const lists = (await page.evaluate(`window.flacon.libraryCall({ op: 'playlists' })`)) as Array<{ name: string }>
    expect(lists.map((l) => l.name)).toContain('Test list')
    await page.getByRole('button', { name: 'Test list' }).first().waitFor()
  })

  it('plays, queues "last", and toggles shuffle and repeat', async () => {
    const songs = await all(page)
    await page.evaluate(`window.flacon.libraryPlay({ source: { kind: 'paths', paths: [${JSON.stringify(songs[0]!.path)}] }, mode: 'play' })`)
    await until(async () => (await call(page, (f) => f.getPlayback())).status === 'playing')
    await page.evaluate(`window.flacon.libraryPlay({ source: { kind: 'paths', paths: [${JSON.stringify(songs[1]!.path)}] }, mode: 'last' })`)
    const q = await until(async () => { const x = await call(page, (f) => f.getQueue()); return x.items.length === 2 && x })
    expect(q.items).toHaveLength(2)
    await call(page, async (f) => f.sendPlayback({ type: 'shuffle', on: true }))
    await call(page, async (f) => f.sendPlayback({ type: 'repeat', mode: 'all' }))
    const s = await until(async () => { const x = await call(page, (f) => f.getPlayback()); return x.shuffle && x.repeat === 'all' && x })
    expect(s.repeat).toBe('all')
  })

  it('shows the queue and the purity percentage in the UI', async () => {
    await page.getByRole('button', { name: 'Library', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Songs' }).click()
    await page.getByRole('row', { name: /Full band/ }).waitFor()
    expect(await page.getByRole('row', { name: /Full band/ }).innerText()).toMatch(/\d+\s?%/)
    await page.getByRole('tab', { name: /Up next/ }).click()
    await page.locator('.qrow').first().waitFor()
  })

  it.runIf(process.platform === 'darwin')('has a native app menu with Settings… (⌘,) under Flacon', async () => {
    const info = await app.evaluate(({ Menu }) => { const m = Menu.getApplicationMenu()!.items[0]!; return { label: m.label, items: m.submenu!.items.map((i) => `${i.label}|${i.accelerator ?? ''}`) } })
    expect(info.label).toBe('Flacon')
    expect(info.items).toContain('Settings…|Cmd+,')
  })

  it('exposes Flacon Island options and honours the switch', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('heading', { name: 'Flacon Island' }).waitFor()
    expect(app.windows().some((w) => w.url().endsWith('/island.html'))).toBe(true)
    await call(page, (f) => f.setSettings({ islandEnabled: false }))
    await until(async () => !app.windows().some((w) => w.url().endsWith('/island.html')))
    await call(page, (f) => f.setSettings({ islandEnabled: true }))
    await until(async () => app.windows().some((w) => w.url().endsWith('/island.html')))
  })

  it('places the island at all six spots, on screen, and the picker in Settings drives it', async () => {
    const bounds = (): Promise<{ b: { x: number; y: number; width: number; height: number }; w: { x: number; y: number; width: number; height: number } }> =>
      app.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('/island.html'))!
        const b = win.getBounds()
        return { b, w: screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea }
      })
    for (const [edge, align] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'center'], ['bottom', 'right'], ['top', 'center']] as const) {
      await page.evaluate(`window.flacon.setSettings(${JSON.stringify({ islandEdge: edge, islandAlign: align })})`)
      await until(async () => {
        const { b, w } = await bounds()
        if (align === 'left' && b.x !== w.x + 12) return false
        if (align === 'right' && b.x + b.width !== w.x + w.width - 12) return false
        if (edge === 'bottom' && b.y + b.height !== w.y + w.height) return false
        if (edge === 'top' && b.y > w.y) return false // flush with the work area, or the physical top on a notched Mac
        return true
      })
      const island = app.windows().find((x) => x.url().endsWith('/island.html'))!
      await until(async () => (await island.locator('.isl-stage').getAttribute('data-edge')) === edge && (await island.locator('.isl-stage').getAttribute('data-align')) === align)
    }
    // The Settings picker is a labelled radio group that reflects and changes the same setting.
    await page.getByRole('radio', { name: 'Bottom right' }).click()
    await until(async () => (await page.evaluate('window.flacon.getSettings()') as { islandEdge: string; islandAlign: string }).islandAlign === 'right')
    expect(await page.getByRole('radio', { name: 'Bottom right' }).getAttribute('aria-checked')).toBe('true')
    await page.evaluate(`window.flacon.setSettings(${JSON.stringify({ islandEdge: 'top', islandAlign: 'center' })})`)
  })

  it('dropped paths are validated in main: audio files play, everything else is ignored', async () => {
    const note = join(root, 'notes.txt')
    writeFileSync(note, 'not music')
    const pick = async (path: string): Promise<{ folders: number; files: number; ignored: number }> => {
      await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'e2e-drop'; document.body.appendChild(i) })
      await page.locator('#e2e-drop').setInputFiles(path)
      const r = (await page.evaluate("(() => { const f = document.getElementById('e2e-drop').files; return window.flacon.libraryAddDropped([...f]) })()")) as { folders: number; files: number; ignored: number }
      await page.evaluate(() => document.getElementById('e2e-drop')?.remove())
      return r
    }
    expect(await pick(note)).toEqual({ folders: 0, files: 0, ignored: 1 })
    const song = (await all(page))[0]!.path
    expect(await pick(song)).toEqual({ folders: 0, files: 1, ignored: 0 })
    await until(async () => (await call(page, (f) => f.getPlayback())).status === 'playing')
  })

  it('albums without cover art get the generated placeholder sleeve', async () => {
    const albums = (await page.evaluate('window.flacon.libraryAlbums()')) as Array<{ sleeve: string; artUrl: string | null }>
    expect(albums.length).toBeGreaterThan(0)
    for (const a of albums.filter((x) => !x.artUrl)) expect(a.sleeve).toMatch(/^url\("data:image\/svg\+xml,/)
  })

  it('the island has a close button that hides it and turns the setting off', async () => {
    const find = (): Page | undefined => app.windows().find((w) => w.url().endsWith('/island.html'))
    const island = await until(async () => find())
    await until(async () => (await island.locator('.isl-activity, .isl-error').count()) === 0) // let the "Now playing" announcement pass
    await island.locator('.isl').hover() // hover intent expands to the control row
    await island.getByRole('button', { name: 'Hide Flacon Island' }).click({ timeout: 10_000 })
    await until(async () => !find())
    const cfg = (await page.evaluate('window.flacon.getSettings()')) as { islandEnabled: boolean }
    expect(cfg.islandEnabled).toBe(false)
    await call(page, (f) => f.setSettings({ islandEnabled: true }))
    await until(async () => find())
  })

  it('the tray icon is a real, sized image (the full-colour app icon)', async () => {
    const b64 = /'([A-Za-z0-9+/=]{100,})'/.exec(readFileSync(resolve('src/main/trayIcon.ts'), 'utf8'))![1]!
    const size = await app.evaluate(({ nativeImage }, data) => { const i = nativeImage.createFromBuffer(Buffer.from(data, 'base64'), { scaleFactor: 2 }); return { empty: i.isEmpty(), ...i.getSize() } }, b64)
    expect(size.empty).toBe(false)
    expect(size.width).toBe(22) // 44 px at 2x → 22 pt, the menu-bar size
  })
})
