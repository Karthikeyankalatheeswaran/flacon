/** "Report a problem": a plain-text report the user can read, copy or save. Nothing is ever sent automatically. */

/** Strip what identifies the person or their files: home folder, e-mail addresses, long tokens, URL query strings. */
export function redact(text: string, home: string, user = ''): string {
  let out = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>') // first: the user name may be part of an address
  const homes = [home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')].filter((h) => h.length > 3)
  for (const h of new Set(homes)) out = out.split(h).join('~')
  if (user.length > 2) out = out.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '<user>')
  return out
    .replace(/\b(https?:\/\/[^\s?#]+)\?[^\s]*/g, '$1?<query>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>')
    // Music paths: keep the file name, drop the folders that reveal how the library is organised.
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\\/\n"']{1,120}){3,}[\\/]([^\\/\n"']+\.(?:flac|wav|aiff?|alac|m4a|mp3|ogg|opus|ape|wv|cue))/gi, '<music>/$1')
}

export interface ReportInput {
  version: string
  platform: string
  osVersion: string
  arch: string
  electron: string
  chrome: string
  node: string
  /** Setting names and simple values only: never paths. */
  settings: Record<string, string | number | boolean>
  log: string[]
  crashDumps: number
  note: string
  home: string
  user?: string
  now?: Date
}

export const REPORT_MAX_LOG_LINES = 200
export const REPORT_MAX_CHARS = 60_000

export function buildReport(i: ReportInput): string {
  const settings = Object.entries(i.settings).map(([k, v]) => `  ${k}: ${v}`).join('\n')
  const body = [
    'Flacon problem report',
    `Created: ${(i.now ?? new Date()).toISOString()}`,
    '',
    'What happened (written by you):',
    i.note.trim() ? i.note.trim().slice(0, 4000) : '(nothing written)',
    '',
    'App',
    `  Flacon ${i.version}`,
    `  ${i.platform} ${i.osVersion} (${i.arch})`,
    `  Electron ${i.electron}, Chromium ${i.chrome}, Node ${i.node}`,
    `  Crash dumps kept on this computer: ${i.crashDumps}`,
    '',
    'Settings',
    settings || '  (default)',
    '',
    `Recent events (last ${Math.min(i.log.length, REPORT_MAX_LOG_LINES)})`,
    ...(i.log.length ? i.log.slice(-REPORT_MAX_LOG_LINES).map((l) => `  ${l}`) : ['  (none)'])
  ].join('\n')
  return redact(body, i.home, i.user).slice(0, REPORT_MAX_CHARS)
}
