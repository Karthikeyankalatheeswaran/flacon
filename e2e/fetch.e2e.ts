// Real-network test of the fetcher against the Internet Archive. Opt-in: E2E_NET=1 npx vitest run --config vitest.e2e.config.ts e2e/fetch.e2e.ts
// Downloads one ~22 MB public-domain FLAC ("Charleston (Fox Trot)", 1925) into a temp import folder; nothing touches the real library.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const net = process.env['E2E_NET'] === '1'
const root = mkdtempSync(join(tmpdir(), 'flacon-fetch-'))
const imports = join(root, 'imports')
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.skipIf(!net)('fetcher, real network', () => {
  let app: ElectronApplication
  let page: Page
  beforeAll(async () => {
    app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'ud')}`], env: { ...process.env, FLACON_IMPORT_DIR: imports } as Record<string, string>, timeout: 45_000 })
    for (let i = 0; i < 100 && !app.windows().some((w) => w.url().endsWith('/index.html')); i++) await new Promise((r) => setTimeout(r, 200))
    page = app.windows().find((w) => w.url().endsWith('/index.html'))!
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('dialog', { name: /welcome/i }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: /welcome/i }).waitFor({ state: 'detached' })
  }, 90_000)
  afterAll(async () => void (await app?.close().catch(() => undefined)))

  it('searches, downloads, verifies, imports and indexes a licensed FLAC', async () => {
    await page.getByRole('button', { name: /^Fetch/ }).first().click()
    await page.getByRole('tab', { name: 'Internet Archive' }).click()
    await page.getByLabel('Search Internet Archive').fill('Charleston Fox Trot 1925')
    await page.getByRole('button', { name: 'Search' }).click()
    const hit = page.getByRole('list', { name: 'Results' }).getByRole('listitem').filter({ hasText: /Charleston \(Fox Trot\)/ }).first()
    await hit.waitFor({ timeout: 30_000 })
    await hit.getByRole('button', { name: 'Fetch' }).click()
    const job = page.getByRole('list', { name: 'Fetch queue' }).getByRole('listitem').first()
    await job.waitFor({ timeout: 15_000 })
    await page.getByRole('list', { name: 'Fetch queue' }).getByRole('listitem').filter({ hasText: /In your library|Failed/ }).first().waitFor({ timeout: 240_000 })
    expect(await page.getByRole('list', { name: 'Fetch queue' }).getByRole('listitem').first().getAttribute('aria-label')).toMatch(/In your library/)
    const files: string[] = []
    const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name)) }
    expect(existsSync(imports)).toBe(true)
    walk(imports)
    const flacs = files.filter((f) => f.toLowerCase().endsWith('.flac'))
    expect(flacs.length).toBeGreaterThan(0)
    expect(statSync(flacs[0]!).size).toBeGreaterThan(1_000_000)
    // and it shows up in the library
    await page.getByRole('button', { name: 'Library', exact: true }).first().click()
    await page.getByText(/Charleston/).first().waitFor({ timeout: 30_000 })
  }, 300_000)

  it('searches accurately: every word matters, lossless-only lists only FLAC/WAV, and each hit says what it holds', async () => {
    await page.getByRole('button', { name: /^Fetch/ }).first().click()
    await page.getByRole('tab', { name: 'Internet Archive' }).click()
    const search = async (q: string, quality: 'Best available' | 'Lossless only' | 'Compact (MP3)'): Promise<string[]> => {
      await page.getByRole('radio', { name: quality }).click()
      await page.getByLabel('Search Internet Archive').fill(q)
      await page.getByRole('button', { name: 'Search' }).click()
      await page.getByRole('list', { name: 'Results' }).or(page.getByText('No licensed matches')).first().waitFor({ timeout: 30_000 })
      return page.getByRole('list', { name: 'Results' }).getByRole('listitem').allInnerTexts().catch(() => [])
    }
    const lossless = await search('miles davis', 'Lossless only')
    expect(lossless.length).toBeGreaterThan(0)
    for (const t of lossless) expect(t).toMatch(/FLAC|WAV/) // the badge
    const moon = await search('beethoven moonlight sonata', 'Best available')
    expect(moon.length).toBeGreaterThan(0)
    expect(moon[0]!.toLowerCase()).toMatch(/moonlight/) // the top hit is about the thing typed, not noise
    for (const t of moon.slice(0, 5)) expect(t.toLowerCase()).toMatch(/moonlight|beethoven|sonata/)
  }, 120_000)
})

describe.skipIf(!net)('fetcher, all sources', () => {
  it('searches every source at once and labels where each hit came from', async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'flacon-fetch-all-'))
    const app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(root2, 'ud')}`], env: { ...process.env, FLACON_IMPORT_DIR: join(root2, 'imports') } as Record<string, string>, timeout: 45_000 })
    try {
      for (let i = 0; i < 100 && !app.windows().some((w) => w.url().endsWith('/index.html')); i++) await new Promise((r) => setTimeout(r, 200))
      const page = app.windows().find((w) => w.url().endsWith('/index.html'))!
      await page.getByRole('dialog', { name: /welcome/i }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Fetch/ }).first().click()
      await page.getByRole('group', { name: 'Search ideas' }).getByRole('button', { name: 'Bach' }).click()
      const list = page.getByRole('list', { name: 'Results' })
      await list.waitFor({ timeout: 45_000 })
      const texts = await list.getByRole('listitem').allInnerTexts()
      expect(texts.length).toBeGreaterThan(2)
      expect(texts.some((t) => /Internet Archive|Wikimedia Commons|ccMixter/.test(t))).toBe(true)
    } finally {
      await app.close().catch(() => undefined)
      rmSync(root2, { recursive: true, force: true })
    }
  }, 120_000)
})
