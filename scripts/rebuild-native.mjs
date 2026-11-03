// Fetch the Electron-ABI better-sqlite3 binary (prebuilt) for a platform/arch (default: this machine). Node script, not shell,
// so it works in cmd/PowerShell too.   node scripts/rebuild-native.mjs [--platform win32|darwin] [--arch x64|arm64]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, dflt) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : dflt)
const require = createRequire(import.meta.url)
const electronVersion = require('electron/package.json').version
const cwd = dirname(require.resolve('better-sqlite3/package.json'))
const bin = require.resolve('prebuild-install/bin.js', { paths: [cwd] })
execFileSync(process.execPath, [bin, '-r', 'electron', '-t', electronVersion, '--platform', opt('platform', process.platform), '--arch', opt('arch', process.arch), '--force'], { cwd, stdio: 'inherit' })
