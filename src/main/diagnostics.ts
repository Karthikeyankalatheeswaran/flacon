import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { homedir, release, userInfo } from 'node:os'
import { join } from 'node:path'
import { app, clipboard, crashReporter, dialog, type BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { buildReport, redact } from '@shared/report'

// Local-only diagnostics: a small rolling log and Electron's own crash dumps, both kept on this computer.
// Nothing is uploaded; the user reads, copies or saves a redacted report themselves.

const MAX_FILE = 256 * 1024
const MEMORY = 400
const lines: string[] = []
let file = ''

const stamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19)

export function logEvent(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `${stamp()} ${level.toUpperCase()} ${message.replace(/\s+/g, ' ').slice(0, 600)}`
  lines.push(line)
  if (lines.length > MEMORY) lines.shift()
  if (!file) return
  try {
    appendFileSync(file, `${line}\n`)
    if (statSync(file).size > MAX_FILE) renameSync(file, `${file}.1`) // keep one previous file, drop older ones
  } catch {
    /* logging must never take the app down */
  }
}

export function startDiagnostics(): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'flacon.log')
    // Carry the tail of the last session over: a crash report is most useful with what happened just before it.
    if (existsSync(file)) lines.push(...readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-150))
  } catch {
    file = ''
  }
  try {
    crashReporter.start({ uploadToServer: false, compress: true, productName: 'Flacon', submitURL: '' })
  } catch {
    /* not available: carry on without dumps */
  }
  logEvent('info', `Start: Flacon ${app.getVersion()} on ${process.platform} ${process.arch}`)
  process.on('uncaughtException', (e) => logEvent('error', `uncaughtException: ${e.stack ?? e.message}`))
  process.on('unhandledRejection', (r) => logEvent('error', `unhandledRejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`))
  app.on('render-process-gone', (_e, wc, d) => logEvent('error', `render-process-gone (${wc.getType()}): ${d.reason} exit ${d.exitCode}`))
  app.on('child-process-gone', (_e, d) => logEvent('error', `child-process-gone (${d.type}${d.name ? ` ${d.name}` : ''}): ${d.reason} exit ${d.exitCode}`))
}

function crashDumps(): number {
  try {
    const walk = (dir: string, depth: number): number =>
      readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() && depth < 2 ? walk(join(dir, e.name), depth + 1) : e.name.endsWith('.dmp') ? 1 : 0), 0)
    return walk(app.getPath('crashDumps'), 0)
  } catch {
    return 0
  }
}

/** The report text, redacted. `settings` are simple name/value pairs chosen by the caller: never paths. */
export function makeReport(note: string, settings: Record<string, string | number | boolean>): string {
  let user = ''
  try { user = userInfo().username } catch { /* unknown */ }
  return buildReport({
    version: app.getVersion(), platform: process.platform, osVersion: release(), arch: process.arch,
    electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '', node: process.versions.node ?? '',
    settings, log: lines.map((l) => redact(l, homedir(), user)), crashDumps: crashDumps(), note, home: homedir(), user
  })
}

export async function reportAction(op: 'get' | 'copy' | 'save', text: string, win: BrowserWindow | undefined): Promise<{ ok: boolean; message: string }> {
  if (op === 'copy') {
    clipboard.writeText(text)
    return { ok: true, message: 'Report copied.' }
  }
  if (op === 'save') {
    const opts = { defaultPath: join(app.getPath('documents'), `flacon-report-${new Date().toISOString().slice(0, 10)}.txt`), filters: [{ name: 'Text', extensions: ['txt'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, message: 'Cancelled.' }
    await fsp.writeFile(r.filePath, text, 'utf8')
    return { ok: true, message: 'Report saved.' }
  }
  return { ok: true, message: '' }
}

// Renderer-side errors arrive here; cap the rate so a render loop can't flood the log.
let windowStart = 0
let inWindow = 0
export function logFromRenderer(message: string): void {
  const now = Date.now()
  if (now - windowStart > 60_000) { windowStart = now; inWindow = 0 }
  if (++inWindow > 30) return
  logEvent('error', `renderer: ${message}`)
}
