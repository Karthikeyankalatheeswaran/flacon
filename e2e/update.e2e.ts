// Auto-update flow against a local feed. Driven by scripts/test-update-flow.sh (which builds v0.1.0 + v0.1.1 and serves the feed);
// skipped unless E2E_UPDATE_APP points at the *older* packaged app.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const appPath = process.env['E2E_UPDATE_APP']
const root = mkdtempSync(join(tmpdir(), 'flacon-upd-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.skipIf(!appPath)('auto-update via a local feed', () => {
  let app: ElectronApplication
  let page: Page
  beforeAll(async () => {
    app = await electron.launch({ executablePath: appPath!, args: [`--user-data-dir=${join(root, 'ud')}`], timeout: 45_000 })
    for (let i = 0; i < 100 && !app.windows().some((w) => w.url().endsWith('/index.html')); i++) await new Promise((r) => setTimeout(r, 200))
    page = app.windows().find((w) => w.url().endsWith('/index.html'))!
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('dialog', { name: /welcome/i }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: /welcome/i }).waitFor({ state: 'detached' })
  }, 90_000)
  afterAll(async () => void (await app?.close().catch(() => undefined)))

  it('finds the newer version, downloads it with checksum verification, and offers a restart', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Check now' }).click()
    await page.getByText('Version 0.1.1 is available.').waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Download' }).click()
    await page.getByText(/Version 0.1.1 is ready/).waitFor({ timeout: 120_000 })
    expect(await page.getByRole('button', { name: 'Restart to update' }).count()).toBe(1)
  }, 180_000)
})
