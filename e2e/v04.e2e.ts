import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// v0.4 features through the real app: loudness/DR, duplicates, queue undo, shortcuts, mini player, visualizer, report.
const root = mkdtempSync(join(tmpdir(), 'flacon-v04-'))
const lib = join(root, 'music')
afterAll(() => rmSync(root, { recursive: true, force: true }))

const sine = (file: string, amp: number, title: string, secs = 12): void =>
  void execFileSync(ffmpegPath as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=997:d=${secs}:r=44100`, '-af', `volume=${amp}`, '-sample_fmt', 's16', '-metadata', `title=${title}`, '-metadata', 'artist=Test', '-metadata', 'album=Tones', file])

type Song = { path: string; title: string; lufs?: number | null; dr?: number | null }
const until = async <T>(f: () => Promise<T | false | undefined>, ms = 40_000): Promise<T> => {
  const t = Date.now()
  for (;;) {
    const v = await f().catch(() => undefined)
    if (v) return v
    if (Date.now() - t > ms) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 250))
  }
}
const songs = (p: Page): Promise<Song[]> => p.evaluate(`window.flacon.librarySongs({ sort: 'title', dir: 'asc', text: '', offset: 0, limit: 50 }).then((r) => r.rows)`) as Promise<Song[]>
const menuClick = (a: ElectronApplication, label: string): Promise<boolean> =>
  a.evaluate(({ Menu }, l) => {
    const walk = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => { for (const i of items) { if (i.label === l) return i; const f = i.submenu ? walk(i.submenu.items) : undefined; if (f) return f } return undefined }
    const it = walk(Menu.getApplicationMenu()!.items)
    it?.click()
    return !!it
  }, label)

let app: ElectronApplication
let page: Page

beforeAll(async () => {
  mkdirSync(join(lib, 'Tones'), { recursive: true })
  mkdirSync(join(lib, 'Comp'), { recursive: true })
  sine(join(lib, 'Tones', '01 Loud.flac'), 0.5, 'Loud')
  sine(join(lib, 'Tones', '02 Quiet.flac'), 0.05, 'Quiet')
  copyFileSync(join(lib, 'Tones', '01 Loud.flac'), join(lib, 'Comp', '01 Loud.flac')) // a duplicate
  app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'ud')}`], env: { ...process.env, FLACON_LIBRARY_FOLDER: lib } as Record<string, string>, timeout: 45_000 })
  for (let i = 0; i < 100 && !app.windows().some((w) => w.url().endsWith('/index.html')); i++) await new Promise((r) => setTimeout(r, 200))
  page = app.windows().find((w) => w.url().endsWith('/index.html'))!
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('dialog', { name: /welcome/i }).waitFor({ timeout: 15_000 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
  await page.getByRole('dialog', { name: /welcome/i }).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
}, 90_000)
afterAll(async () => void (await app?.close().catch(() => undefined)))

describe('loudness', () => {
  it('measures integrated LUFS in the background, and the louder file reads louder by ~20 dB', async () => {
    const rows = await until(async () => { const r = await songs(page); return r.length === 3 && r.every((s) => typeof s.lufs === 'number') && r })
    const loud = rows.find((r) => r.title === 'Loud')!
    const quiet = rows.find((r) => r.title === 'Quiet')!
    expect(loud.lufs! - quiet.lufs!).toBeGreaterThan(19)
    expect(loud.lufs! - quiet.lufs!).toBeLessThan(21)
    // A steady tone has essentially no dynamics.
    expect(loud.dr ?? 0).toBeLessThan(2)
  }, 60_000)
})

describe('duplicates', () => {
  it('finds the second copy of a song', async () => {
    const groups = (await page.evaluate(`window.flacon.libraryCall({ op: 'duplicates' })`)) as Array<{ title: string; members: Array<{ path: string }> }>
    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toBe('Loud')
    expect(groups[0]!.members).toHaveLength(2)
  })
  it('lists it on the Duplicates page and keeps one copy ticked-free', async () => {
    await page.getByRole('button', { name: 'Duplicates', exact: true }).click()
    await page.getByRole('list', { name: 'Duplicate songs' }).waitFor({ timeout: 15_000 })
    const list = page.getByRole('list', { name: 'Duplicate songs' })
    expect(await list.getByText('Keep', { exact: true }).count()).toBe(1)
    expect(await list.getByRole('checkbox').count()).toBe(1) // only the extra copy can be ticked
  })
  it('refuses to trash anything that is not a duplicate (the renderer cannot choose arbitrary files)', async () => {
    const victim = join(root, 'victim.txt')
    execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(victim)}, 'x')`])
    const r = (await page.evaluate(`window.flacon.trashDuplicates(${JSON.stringify([victim, '/etc/hosts'])})`)) as { trashed: number }
    expect(r.trashed).toBe(0)
    expect(existsSync(victim)).toBe(true)
    // Even asking for every copy of a real duplicate must not be allowed to remove the last one: main asks to confirm and spares one.
    // (The native confirmation dialog can't be driven here, so this part is covered by unit tests of safeToTrash.)
  })
})

describe('queue undo', () => {
  it('Clear can be undone, and the history lists it', async () => {
    const all = await songs(page)
    await page.evaluate(`window.flacon.libraryPlay({ source: { kind: 'paths', paths: ${JSON.stringify(all.map((s) => s.path))} }, mode: 'play', index: 0 })`)
    await until(async () => ((await page.evaluate('window.flacon.getQueue()')) as { items: unknown[] }).items.length === 3)
    await page.getByRole('button', { name: 'Library', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Up next' }).click()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await until(async () => ((await page.evaluate('window.flacon.getQueue()')) as { items: unknown[] }).items.length === 1)
    await page.getByRole('button', { name: /History/ }).click()
    await page.getByRole('list', { name: 'Earlier queues' }).waitFor()
    await page.getByRole('button', { name: /Undo/ }).click()
    await until(async () => ((await page.evaluate('window.flacon.getQueue()')) as { items: unknown[] }).items.length === 3)
  }, 40_000)
})

describe('shortcuts', () => {
  it('rewrites the native menu accelerator, rejects reserved keys and conflicts, and resets', async () => {
    const accel = (label: string): Promise<string | undefined> => app.evaluate(({ Menu }, l) => {
      const walk = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => { for (const i of items) { if (i.label === l) return i; const f = i.submenu ? walk(i.submenu.items) : undefined; if (f) return f } return undefined }
      return walk(Menu.getApplicationMenu()!.items)?.accelerator as string | undefined
    }, label)
    expect(await accel('Next')).toBe('CmdOrCtrl+Right')
    await page.evaluate(`window.flacon.setSettings({ shortcuts: { next: 'ctrl+alt+k', prev: 'CmdOrCtrl+Q', bogus: 'CmdOrCtrl+K' } })`)
    await until(async () => (await accel('Next')) === 'Ctrl+Alt+K')
    expect(await accel('Previous')).toBe('CmdOrCtrl+Left') // reserved key refused, default kept
    const s = (await page.evaluate('window.flacon.getSettings()')) as { shortcuts: Record<string, string> }
    expect(s.shortcuts).toEqual({ next: 'Ctrl+Alt+K' }) // unknown commands and reserved keys never reach disk
    await page.evaluate(`window.flacon.setSettings({ shortcuts: {} })`)
    await until(async () => (await accel('Next')) === 'CmdOrCtrl+Right')
  })
})

describe('mini player', () => {
  it('opens from View ▸ Mini Player, shows the playing song, and closes itself', async () => {
    expect(await menuClick(app, 'Mini Player')).toBe(true)
    const mini = await until(async () => app.windows().find((w) => w.url().endsWith('/mini.html')))
    await mini.waitForLoadState('domcontentloaded')
    await mini.getByRole('main', { name: 'Mini player' }).waitFor()
    await mini.getByRole('button', { name: /Pause|Play/ }).waitFor()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Flacon Mini Player')?.isAlwaysOnTop())).toBe(true)
    await mini.getByRole('button', { name: 'Close mini player' }).click()
    await until(async () => !app.windows().some((w) => w.url().endsWith('/mini.html') && !w.isClosed()))
  }, 30_000)
})

describe('visualizer', () => {
  it('streams spectrum bars only while the tab is open', async () => {
    await page.evaluate(`window.flacon.sendPlayback({ type: 'play' })`)
    await until(async () => ((await page.evaluate('window.flacon.getPlayback()')) as { status: string }).status === 'playing')
    await page.getByRole('tab', { name: 'Visualizer' }).click()
    await page.getByRole('img', { name: /spectrum/i }).waitFor()
    const frames = (await page.evaluate(`new Promise((res) => { let n = 0; const off = window.flacon.onViz(() => n++); setTimeout(() => { off(); res(n) }, 1000) })`)) as number
    expect(frames).toBeGreaterThan(10)
  }, 30_000)
})

describe('report a problem', () => {
  it('builds a report that contains the version and the note but not the home folder', async () => {
    const r = (await page.evaluate(`window.flacon.report({ op: 'get', note: 'it broke at ' + ${JSON.stringify(process.env['HOME'] ?? '/Users/x')} + '/Music, mail me@example.com' })`)) as { text: string }
    expect(r.text).toContain('Flacon problem report')
    expect(r.text).toContain('it broke at')
    expect(r.text).not.toContain(process.env['HOME'] ?? '/Users/x')
    expect(r.text).not.toContain('me@example.com')
    expect(r.text).not.toMatch(/library\.db|FLACON_LIBRARY_FOLDER/)
  })
  it('refuses a malformed request instead of crashing', async () => {
    await expect(page.evaluate(`window.flacon.report({ op: 'delete-everything', note: '' })`)).rejects.toThrow()
  })
})

describe('output device', () => {
  it('lists outputs in playback state and persists the chosen name', async () => {
    const pb = (await page.evaluate('window.flacon.getPlayback()')) as { outputDevices: unknown[]; outputId: string }
    expect(Array.isArray(pb.outputDevices)).toBe(true)
    await page.evaluate(`window.flacon.setSettings({ outputDevice: 'Nonexistent DAC' })`)
    const s = (await page.evaluate('window.flacon.getSettings()')) as { outputDevice: string }
    expect(s.outputDevice).toBe('Nonexistent DAC')
    const after = (await page.evaluate('window.flacon.getPlayback()')) as { status: string }
    expect(['playing', 'paused', 'loading']).toContain(after.status) // an unplugged device never breaks playback
    await page.evaluate(`window.flacon.setSettings({ outputDevice: '' })`)
  })
})
