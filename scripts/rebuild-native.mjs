// better-sqlite3 >= 13 ships N-API prebuilds for every platform/arch inside the package (prebuilds/<platform>-<arch>.node),
// so no per-Electron-ABI rebuild or download is needed any more. This script is kept so `npm run rebuild:native` and
// scripts/package-all.sh still work: it only verifies the binary for the requested target exists.
//   node scripts/rebuild-native.mjs [--platform win32|darwin] [--arch x64|arm64]
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, dflt) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : dflt)
const require = createRequire(import.meta.url)
const file = join(dirname(require.resolve('better-sqlite3/package.json')), 'prebuilds', `${opt('platform', process.platform)}-${opt('arch', process.arch)}.node`)
if (!existsSync(file)) {
  console.error(`missing better-sqlite3 prebuild: ${file}`)
  process.exit(1)
}
console.log(`better-sqlite3 prebuild present: ${file}`)
