// Automated accessibility audit (axe-core, WCAG 2.1 A/AA rules) of every screen in the real app, in light and dark.
// This is NOT a screen-reader test; see docs/accessibility.md for the VoiceOver / NVDA script.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'flacon-a11y-'))
const lib = join(root, 'music')
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
afterAll(() => rmSync(root, { recursive: true, force: true }))

let app: ElectronApplication
let page: Page

async function audit(label: string): Promise<void> {
  await page.evaluate(axeSource) // CSP blocks <script> injection, but evaluate runs as a privileged call
  const res = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run(ctx: unknown, o: unknown): Promise<{ violations: Array<{ id: string; impact: string; help: string; nodes: Array<{ target: string[]; html: string; any: Array<{ data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } }> }> }> }> } }).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
    })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 120)} ${JSON.stringify(n.any[0]?.data ?? {})}`) }))
  })
  for (const v of res) found.push(`${label} — ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.join('\n    ')}`)
}
const found: string[] = []

beforeAll(async () => {
  mkdirSync(join(lib, 'A', 'Album'), { recursive: true })
  for (const [n, hz] of [['01 One', 220], ['02 Two', 330]] as const)
    execFileSync(ffmpegPath as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${hz}:d=20:r=44100`, '-metadata', `title=${n.slice(3)}`, '-metadata', 'artist=Zed', '-metadata', 'album=Night Album', join(lib, 'A', 'Album', `${n}.flac`)])
  writeFileSync(join(lib, 'A', 'Album', 'x.cue'), '')
  app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'ud')}`], env: { ...process.env, FLACON_LIBRARY_FOLDER: lib } as Record<string, string>, timeout: 45_000 })
  for (let i = 0; i < 100 && !app.windows().some((w) => w.url().endsWith('/index.html')); i++) await new Promise((r) => setTimeout(r, 200))
  page = app.windows().find((w) => w.url().endsWith('/index.html'))!
  await page.waitForLoadState('domcontentloaded')
}, 90_000)
afterAll(async () => void (await app?.close().catch(() => undefined)))

describe('axe audit', () => {
  afterAll(() => { if (found.length) console.log('AXE VIOLATIONS\n' + found.join('\n')) })
  it('first-run welcome dialog', async () => {
    await page.getByRole('dialog', { name: /welcome/i }).waitFor()
    await audit('onboarding')
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: /welcome/i }).waitFor({ state: 'detached' })
  })
  for (const theme of ['Light', 'Dark'] as const) {
    it(`screens in ${theme} theme`, async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('radio', { name: theme }).click()
      await audit(`settings/${theme}`)
      await page.getByRole('button', { name: 'Library', exact: true }).first().click()
      await page.getByText('Night Album').first().waitFor({ timeout: 20_000 })
      await audit(`albums/${theme}`)
      for (const tab of ['Songs', 'Artists', 'Folders']) {
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForTimeout(400)
        await audit(`${tab}/${theme}`)
      }
      await page.getByRole('tab', { name: 'Albums' }).click()
      await page.getByRole('button', { name: /^Fetch/ }).first().click()
      await audit(`fetch/${theme}`)
      await page.getByRole('button', { name: 'Library', exact: true }).first().click()
      await page.getByRole('button', { name: 'Equalizer', exact: true }).click()
      await page.waitForTimeout(800) // let the panel's entrance animation finish: axe would otherwise measure a half-faded colour
      await audit(`eq/${theme}`)
      await page.keyboard.press('Escape')
    })
  }
  it('island window', async () => {
    const island = app.windows().find((w) => w.url().endsWith('/island.html'))!
    await island.evaluate(axeSource)
    const v = await island.evaluate(async () => (await (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: Array<{ id: string }> }> } }).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map((x) => x.id))
    expect(v).toEqual([])
  })
  it('found no WCAG A/AA violations anywhere', () => {
    expect(found.join('\n')).toBe('')
  })
})
