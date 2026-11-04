import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const tone = (file: string, hz: number, tags: Record<string, string>, seconds = 40): void =>
  void execFileSync(ffmpegPath as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${hz}:d=${seconds}:r=44100`, '-sample_fmt', 's16', ...Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), file])

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
const pb = (p: Page) => p.evaluate(() => (window as unknown as { flacon: { getPlayback(): Promise<{ status: string; positionSec: number; queueIndex: number; track: { title: string; durationSec: number } | null; eq: { preset: string; enabled: boolean } }> } }).flacon.getPlayback())

beforeAll(() => {
  mkdirSync(join(lib, 'Zed', 'Night Album'), { recursive: true })
  tone(join(lib, 'Zed', 'Night Album', '01 Moth.flac'), 220, { title: 'Moth', artist: 'Zed', album: 'Night Album', track: '1', date: '2020' })
  tone(join(lib, 'Zed', 'Night Album', '02 Lantern.flac'), 330, { title: 'Lantern', artist: 'Zed', album: 'Night Album', track: '2', date: '2020' })
  // One 45 s file + a CUE sheet with three tracks (0 s / 15 s / 30 s): must index as three songs, not one.
  mkdirSync(join(lib, 'Mixes'), { recursive: true })
  tone(join(lib, 'Mixes', 'set.flac'), 440, {}, 45)
  writeFileSync(join(lib, 'Mixes', 'set.cue'), 'PERFORMER "DJ Cue"\nTITLE "Cue Set"\nFILE "set.wav" WAVE\n  TRACK 01 AUDIO\n    TITLE "Cue One"\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    TITLE "Cue Two"\n    INDEX 01 00:15:00\n  TRACK 03 AUDIO\n    TITLE "Cue Three"\n    INDEX 01 00:30:00\n')
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

  it('loads the bundled Archivo font under the strict CSP (no remote fonts)', async () => {
    const loaded = await until(async () => page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.includes('Archivo') && f.status === 'loaded') }))
    expect(loaded).toBe(true)
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
    await page.getByRole('button', { name: 'Library', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Songs' }).click()
    await page.getByRole('grid', { name: 'Songs' }).waitFor()
    await page.getByRole('row', { name: /Moth/ }).waitFor()
    await page.getByRole('button', { name: /^Time/ }).click()
    expect(await page.getByRole('columnheader', { name: /Time/ }).getAttribute('aria-sort')).toBe('descending')
  })

  it('indexes a CUE sheet as separate tracks and plays a slice with its own title and length', async () => {
    await page.getByRole('tab', { name: 'Songs' }).click()
    await page.getByRole('row', { name: /Cue Two/ }).waitFor({ timeout: 20_000 })
    expect(await page.getByRole('row', { name: /Cue One/ }).count()).toBe(1)
    expect(await page.getByRole('row', { name: /Cue Three/ }).count()).toBe(1)
    expect(await page.getByRole('row', { name: /^\s*\d*\s*set\b/ }).count()).toBe(0) // the whole 45 s file is not also listed
    await page.getByRole('row', { name: /Cue Two/ }).dblclick()
    const s = await until(async () => { const x = await pb(page); return x.track?.title === 'Cue Two' && x.status === 'playing' && x })
    expect(s.track?.durationSec).toBeCloseTo(15, 0)
    expect(s.positionSec).toBeLessThan(10)
    // it stops at the slice boundary (2 s after this seek) and hands over to the next queue item instead of playing on into the rest of the 45 s file
    await page.evaluate(() => (window as unknown as { flacon: { sendPlayback(c: unknown): void } }).flacon.sendPlayback({ type: 'seek', seconds: 13 }))
    const next = await until(async () => { const x = await pb(page); return x.queueIndex === 1 && x.status === 'playing' && x }, 12_000)
    expect(next.track?.title).not.toBe('Cue Two')
  })

  it('survives rapid seeks right after starting a slice (no stuck "loading")', async () => {
    const send = (c: unknown): Promise<void> => page.evaluate((cmd) => (window as unknown as { flacon: { sendPlayback(c: unknown): void } }).flacon.sendPlayback(cmd), c)
    for (let i = 0; i < 4; i++) {
      await page.getByRole('row', { name: /Cue One/ }).dblclick()
      await until(async () => { const x = await pb(page); return x.status === 'playing' && x })
      await send({ type: 'seek', seconds: 3 + i })
      await send({ type: 'seek', seconds: 5 + i })
      const x = await until(async () => { const y = await pb(page); return y.status === 'playing' && y.positionSec >= 5 && y }, 8_000)
      expect(x.status).toBe('playing')
    }
  })

  it('browses Artists: index then the artist’s albums', async () => {
    await page.getByRole('tab', { name: 'Artists' }).click()
    await page.getByRole('button', { name: /^Zed/ }).click()
    await page.getByRole('heading', { name: 'Zed' }).waitFor()
    expect(await page.getByText('Night Album').count()).toBeGreaterThan(0)
    await page.getByRole('button', { name: /All artists/ }).click()
  })

  it('browses Folders on disk and plays from a chosen track', async () => {
    await page.getByRole('tab', { name: 'Folders' }).click()
    const rows = (): ReturnType<typeof page.locator> => page.locator('ul.list .row-btn') // not the Add / breadcrumb buttons
    await rows().first().click()
    await rows().filter({ hasText: /Zed/ }).click()
    await rows().filter({ hasText: /Night Album/ }).click()
    // Breadcrumbs show where we are and let us jump back up.
    await page.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'Zed' }).waitFor()
    await rows().filter({ hasText: /Lantern/ }).click()
    const s = await until(async () => { const x = await pb(page); return /Lantern/.test(x.track?.title ?? '') && x.status === 'playing' && x })
    expect(s.queueIndex).toBe(1)
    await page.getByRole('tab', { name: 'Albums' }).click()
  })

  it('applies an EQ preset through the engine and persists it', async () => {
    await page.getByRole('button', { name: 'Equalizer', exact: true }).click()
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
    // Focus arrives via the native-menu accelerator -> IPC (async), so poll rather than read once.
    await until(async () => (await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)) === 'search')
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
