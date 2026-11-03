import { z } from 'zod'

// Update state machine: pure, so every transition (including the ugly ones) is tested without electron-updater.

export const UpdateStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unavailable'), reason: z.string().max(200) }), // dev build, or no update feed configured
  z.object({ state: z.literal('idle') }),
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('none') }), // up to date
  z.object({ state: z.literal('available'), version: z.string().max(40) }),
  z.object({ state: z.literal('downloading'), version: z.string().max(40), percent: z.number().min(0).max(100) }),
  z.object({ state: z.literal('ready'), version: z.string().max(40) }),
  z.object({ state: z.literal('error'), message: z.string().max(300) })
])
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'none' }
  | { type: 'available'; version: string }
  | { type: 'download' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded' }
  | { type: 'error'; message: string }
  | { type: 'reset' }

export const initialUpdate: UpdateStatus = { state: 'idle' }

const versionOf = (s: UpdateStatus): string => ('version' in s ? s.version : '')

export function updateReducer(s: UpdateStatus, e: UpdateEvent): UpdateStatus {
  if (s.state === 'unavailable') return s // nothing can change that at runtime
  switch (e.type) {
    case 'check':
      // Never interrupt a download or a finished update that is waiting for a restart.
      return s.state === 'downloading' || s.state === 'ready' || s.state === 'checking' ? s : { state: 'checking' }
    case 'none':
      return s.state === 'checking' ? { state: 'none' } : s
    case 'available':
      return s.state === 'checking' ? { state: 'available', version: e.version } : s
    case 'download':
      return s.state === 'available' ? { state: 'downloading', version: s.version, percent: 0 } : s
    case 'progress':
      return s.state === 'downloading' ? { ...s, percent: Math.max(0, Math.min(100, Math.round(e.percent))) } : s
    case 'downloaded':
      return s.state === 'downloading' ? { state: 'ready', version: versionOf(s) } : s
    case 'error':
      // A failed download must not leave the user stuck: it can be retried from `available` by checking again.
      return s.state === 'ready' ? s : { state: 'error', message: e.message.slice(0, 300) }
    case 'reset':
      return s.state === 'error' || s.state === 'none' ? initialUpdate : s
  }
}

/** Plain-language line for the Settings page. */
export function describeUpdate(s: UpdateStatus): string {
  switch (s.state) {
    case 'unavailable': return s.reason
    case 'idle': return 'Flacon checks for updates automatically.'
    case 'checking': return 'Checking for updates…'
    case 'none': return 'You’re on the latest version.'
    case 'available': return `Version ${s.version} is available.`
    case 'downloading': return `Downloading version ${s.version}… ${s.percent}%`
    case 'ready': return `Version ${s.version} is ready. It installs when you restart.`
    case 'error': return `Couldn’t check for updates: ${s.message}`
  }
}
