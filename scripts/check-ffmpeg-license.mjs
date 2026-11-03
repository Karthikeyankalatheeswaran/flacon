// Release gate: the ffmpeg we ship must be LGPL (no --enable-gpl / --enable-nonfree) and have soxr for high-quality resampling.
// Usage: node scripts/check-ffmpeg-license.mjs [path-to-ffmpeg]   (defaults to $FLACON_FFMPEG or ffmpeg-static)
// Exit code 1 = not shippable. `--report` prints the findings and always exits 0 (for dev builds).
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const report = args.includes('--report')
const given = args.find((a) => !a.startsWith('--'))
const bin = given ?? process.env.FLACON_FFMPEG ?? createRequire(import.meta.url)('ffmpeg-static')

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
