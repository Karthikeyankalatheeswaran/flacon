import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Set E2E_APP=/path/to/Flacon.app/Contents/MacOS/Flacon (or the .exe) to run the same suite against a packaged build.
const packaged = process.env['E2E_APP']
const root = mkdtempSync(join(tmpdir(), 'flacon-e2e-'))
const lib = join(root, 'music')
afterAll(() => rmSync(root, { recursive: true, force: true }))

const tone = (file: string, hz: number, tags: Record<string, string>): void =>
  void execFileSync(ffmpegPath as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${hz}:d=40:r=44100`, '-sample_fmt', 's16', ...Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), file])

async function launch(userData: string, extraArgs: string[] = [], env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    ...(packaged ? { executablePath: packaged, args: [`--user-data-dir=${userData}`, ...extraArgs] } : { args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`, ...extraArgs] }),
    env: { ...process.env, ...env } as Record<string, string>,
    timeout: 45_000
  })
}

async function mainPage(app: ElectronApplication): Promise<Page> {
  const find = (): Page | undefined => app.windows().find((w) => w.url().endsWith('/index.html'))
  for (let i = 0; i < 100 && !find(); i++) await new Promise((r) => setTimeout(r, 200))
  const p = find()
  if (!p) throw new Error('main window never appeared')
  await p.waitForLoadState('domcontentloaded')
  return p
}
const until = async <T>(f: () => Promise<T | false | undefined>, ms = 20_000): Promise<T> => {
  const t = Date.now()
  for (;;) {
    const v = await f().catch(() => undefined)
    if (v) return v
    if (Date.now() - t > ms) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 150))
  }
}
const pb = (p: Page) => p.evaluate(() => (window as unknown as { flacon: { getPlayback(): Promise<{ status: string; positionSec: number; queueIndex: number; track: { title: string } | null; eq: { preset: string; enabled: boolean } }> } }).flacon.getPlayback())

beforeAll(() => {
  mkdirSync(join(lib, 'Zed', 'Night Album'), { recursive: true })
  tone(join(lib, 'Zed', 'Night Album', '01 Moth.flac'), 220, { title: 'Moth', artist: 'Zed', album: 'Night Album', track: '1', date: '2020' })
  tone(join(lib, 'Zed', 'Night Album', '02 Lantern.flac'), 330, { title: 'Lantern', artist: 'Zed', album: 'Night Album', track: '2', date: '2020' })
}, 60_000)

describe('app (fresh profile)', () => {
  let app: ElectronApplication
  let page: Page
  const ud = join(root, 'ud-fresh')
  beforeAll(async () => {
    app = await launch(ud, [join(lib, 'Zed', 'Night Album', '01 Moth.flac')], { FLACON_LIBRARY_FOLDER: lib })
    page = await mainPage(app)
  })
  afterAll(async () => void (await app?.close().catch(() => undefined)))

  it('boots all three windows without an error dialog', async () => {
    await until(async () => app.windows().length >= 3)
    const urls = app.windows().map((w) => w.url())
    expect(urls.some((u) => u.endsWith('/island.html'))).toBe(true)
    expect(urls.some((u) => u.endsWith('/engine.html'))).toBe(true)
    expect(await page.title()).toBe('Flacon')
  })

  it('shows the first-run welcome sheet and lets it be skipped with Escape', async () => {
    await page.getByRole('dialog', { name: /welcome/i }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: /welcome/i }).waitFor({ state: 'detached' })
  })

  it('indexes the seeded folder and shows the album', async () => {
    await page.getByText('Night Album').first().waitFor({ timeout: 20_000 })
    expect(await page.getByText('Night Album').count()).toBeGreaterThan(0)
  })

  it('plays the file opened at launch and the position advances', async () => {
    const first = await until(async () => { const s = await pb(page); return s.status === 'playing' && s })
    expect(first.track?.title).toMatch(/Moth/)
    const later = await until(async () => { const s = await pb(page); return s.positionSec > first.positionSec + 1 && s })
    expect(later.positionSec).toBeGreaterThan(first.positionSec)
  })

  it('lists songs, sorts by a header, and keeps the table accessible', async () => {
    await page.getByRole('tab', { name: 'Songs' }).click()
    await page.getByRole('table', { name: 'Songs' }).waitFor()
    await page.getByRole('row', { name: /Moth/ }).waitFor()
    await page.getByRole('button', { name: /^Time/ }).click()
    expect(await page.getByRole('columnheader', { name: /Time/ }).getAttribute('aria-sort')).toBe('descending')
  })

  it('applies an EQ preset through the engine and persists it', async () => {
    await page.getByRole('button', { name: /^EQ/ }).click()
    await page.getByLabel('Preset').selectOption('Vocal')
    const s = await until(async () => { const x = await pb(page); return x.eq.preset === 'Vocal' && x })
    expect(s.eq.enabled).toBe(true)
    await until(async () => existsSync(join(ud, 'eq.json')))
    expect(JSON.parse(readFileSync(join(ud, 'eq.json'), 'utf8')).preset).toBe('Vocal')
    await page.keyboard.press('Escape')
  })

  it('switches theme from Settings and writes the settings file', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('radio', { name: 'Dark' }).click()
    await until(async () => (await page.evaluate(() => document.documentElement.dataset['theme'])) === 'dark')
    await until(async () => existsSync(join(ud, 'settings.json')) && JSON.parse(readFileSync(join(ud, 'settings.json'), 'utf8')).theme === 'dark')
  })

  it('focuses search with Ctrl+K', async () => {
    await page.getByRole('button', { name: 'Library', exact: true }).first().click()
    await page.keyboard.press('Control+k')
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)).toBe('search')
  })

  it('rejects an insecure link on the Fetch page with a clear message (no network needed)', async () => {
    await page.getByRole('button', { name: /^Fetch/ }).first().click()
    await page.getByRole('tab', { name: 'Paste link' }).click()
    await page.getByLabel('Search Paste link').fill('http://example.com/a.flac')
    await page.getByRole('button', { name: 'Check link' }).click()
    await page.getByRole('alert').filter({ hasText: /https/ }).waitFor()
  })
})

describe('session restore', () => {
  const ud = join(root, 'ud-session')
  it('relaunching with the same profile restores the queue paused at the saved position, with the saved theme', async () => {
    const a = await launch(ud, [join(lib, 'Zed', 'Night Album', '02 Lantern.flac')], { FLACON_LIBRARY_FOLDER: lib })
    const p1 = await mainPage(a)
    await until(async () => { const s = await pb(p1); return s.status === 'playing' && s.positionSec > 3 && s })
    await p1.evaluate(() => (window as unknown as { flacon: { setTheme(t: string): Promise<void> } }).flacon.setTheme('light'))
    await a.close()
    expect(JSON.parse(readFileSync(join(ud, 'settings.json'), 'utf8')).session.paths[0]).toMatch(/02 Lantern\.flac$/)

    const b = await launch(ud, [], { FLACON_LIBRARY_FOLDER: lib })
    try {
      const p2 = await mainPage(b)
      const s = await until(async () => { const x = await pb(p2); return /Lantern/.test(x.track?.title ?? '') && x })
      expect(s.status).toBe('paused') // never blasts audio on launch
      expect(s.positionSec).toBeGreaterThan(2)
      expect(await p2.evaluate(() => document.documentElement.dataset['theme'])).toBe('light')
    } finally {
      await b.close()
    }
  }, 120_000)
})
