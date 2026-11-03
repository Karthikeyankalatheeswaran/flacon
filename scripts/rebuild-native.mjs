// Fetch the Electron-ABI better-sqlite3 binary. Node script (not shell) so it works in cmd/PowerShell too.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const electronVersion = require('electron/package.json').version
const cwd = dirname(require.resolve('better-sqlite3/package.json'))
const bin = require.resolve('prebuild-install/bin.js', { paths: [cwd] })
execFileSync(process.execPath, [bin, '-r', 'electron', '-t', electronVersion, '--arch', process.arch], { cwd, stdio: 'inherit' })
