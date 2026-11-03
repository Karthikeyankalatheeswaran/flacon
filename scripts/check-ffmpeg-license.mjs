// Release gate: the ffmpeg we ship must be LGPL (no --enable-gpl / --enable-nonfree) and have soxr for high-quality resampling.
// Usage: node scripts/check-ffmpeg-license.mjs [path-to-ffmpeg]   (defaults to $FLACON_FFMPEG, then vendor/ffmpeg/<platform>-<arch>/, then ffmpeg-static with --report only)
// Exit code 1 = not shippable. `--report` prints the findings and always exits 0 (for dev builds).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const report = args.includes('--report')
const given = args.find((a) => !a.startsWith('--'))
const vendored = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const bin = given ?? process.env.FLACON_FFMPEG ?? (existsSync(vendored) ? vendored : report ? createRequire(import.meta.url)('ffmpeg-static') : null)
if (!bin) {
  console.log(`No bundled ffmpeg at ${vendored}. Build one with scripts/build-ffmpeg.sh (the GPL ffmpeg-static must not ship).`)
  process.exit(1)
}

const out = execFileSync(bin, ['-hide_banner', '-buildconf'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) +
  execFileSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8' })
const problems = []
if (/--enable-gpl\b/.test(out)) problems.push('built with --enable-gpl (GPL): cannot be bundled in a closed-licence app')
if (/--enable-nonfree\b/.test(out)) problems.push('built with --enable-nonfree: not redistributable')
if (!/--enable-libsoxr\b/.test(out)) problems.push('built without libsoxr: resampling falls back to the default resampler (still correct, lower stop-band rejection)')

console.log(`ffmpeg: ${bin}`)
if (!problems.length) console.log('OK: LGPL build with soxr')
else for (const p of problems) console.log(`- ${p}`)
process.exit(problems.length && !report ? 1 : 0)
