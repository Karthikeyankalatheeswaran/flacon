import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { initialUpdate, updateReducer, type UpdateEvent, type UpdateStatus } from '@shared/update'

// electron-updater is CommonJS: named imports fail in the ESM main bundle, so take it from the default export.
const { autoUpdater } = electronUpdater

const SIX_HOURS = 6 * 60 * 60 * 1000

let status: UpdateStatus = initialUpdate
let emit: (s: UpdateStatus) => void = () => {}
let timer: NodeJS.Timeout | undefined

function apply(e: UpdateEvent): void {
  const next = updateReducer(status, e)
  if (next === status) return
  status = next
  emit(status)
}

/** Why updating can't work in this build, or null when it can. */
function unavailableReason(): string | null {
  if (!app.isPackaged) return 'Updates are available in the installed app.'
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) return 'This build has no update feed configured.'
  return null
}

export const updateStatus = (): UpdateStatus => status

export function startUpdater(onStatus: (s: UpdateStatus) => void, isEnabled: () => boolean): void {
  emit = onStatus
  const why = unavailableReason()
  if (why) {
    status = { state: 'unavailable', reason: why }
    return
  }
  autoUpdater.autoDownload = false // the user decides; nothing is fetched without a click
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.on('update-available', (i) => apply({ type: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => apply({ type: 'none' }))
  autoUpdater.on('download-progress', (p) => apply({ type: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', () => apply({ type: 'downloaded' }))
  autoUpdater.on('error', (e) => apply({ type: 'error', message: e?.message ?? 'Unknown error' }))
  const tick = (): void => { if (isEnabled()) checkForUpdate() }
  setTimeout(tick, 30_000).unref() // not during startup: the first seconds belong to the library and audio engine
  timer = setInterval(tick, SIX_HOURS)
  timer.unref()
}

export function checkForUpdate(): void {
  apply({ type: 'check' })
  if (status.state !== 'checking') return
  autoUpdater.checkForUpdates().catch((e: Error) => apply({ type: 'error', message: e.message }))
}

export function downloadUpdate(): void {
  apply({ type: 'download' })
  if (status.state === 'downloading') autoUpdater.downloadUpdate().catch((e: Error) => apply({ type: 'error', message: e.message }))
}

/** Restart into the new version. Only ever called from an explicit click, never automatically mid-playback. */
export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall()
}

export function stopUpdater(): void {
  clearInterval(timer)
}
