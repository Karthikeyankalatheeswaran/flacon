// Release gate: the ffmpeg we ship must be LGPL (no --enable-gpl / --enable-nonfree) and have soxr for high-quality resampling.
// Usage: node scripts/check-ffmpeg-license.mjs [path-to-ffmpeg]   (defaults to $FLACON_FFMPEG, then vendor/ffmpeg/<platform>-<arch>/, then ffmpeg-static with --report only)
// Exit code 1 = not shippable. `--report` prints the findings and always exits 0 (for dev builds).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const report = args.includes('--report')
const given = args.find((a) => !a.startsWith('--'))
const vendored = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const all = args.includes('--all')
const bin = all ? null : given ?? process.env.FLACON_FFMPEG ?? (existsSync(vendored) ? vendored : report ? createRequire(import.meta.url)('ffmpeg-static') : null)
if (!bin && !all) {
  console.log(`No bundled ffmpeg at ${vendored}. Build one with scripts/build-ffmpeg.sh (the GPL ffmpeg-static must not ship).`)
  process.exit(1)
}


/** Configure string of a binary: run it, or (cross-built for another OS/CPU) read the string ffmpeg embeds in itself. */
function configOf(file) {
  try {
    return execFileSync(file, ['-hide_banner', '-buildconf'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) + execFileSync(file, ['-hide_banner', '-version'], { encoding: 'utf8' })
  } catch {
    const text = readFileSync(file).toString('latin1')
    const i = text.indexOf('--disable-everything')
    if (i === -1) throw new Error(`${file}: cannot run it and found no embedded configuration`)
    let a = i
    let b = i
    while (a > 0 && /[\x20-\x7e]/.test(text[a - 1])) a--
    while (b < text.length && /[\x20-\x7e]/.test(text[b])) b++
    return text.slice(a, b)
  }
}

function check(file) {
  const out = configOf(file)
  const problems = []
  if (/--enable-gpl\b/.test(out)) problems.push('built with --enable-gpl (GPL): cannot be bundled in a closed-licence app')
  if (/--enable-nonfree\b/.test(out)) problems.push('built with --enable-nonfree: not redistributable')
  if (!/--enable-libsoxr\b/.test(out)) problems.push('built without libsoxr: resampling falls back to the default resampler (still correct, lower stop-band rejection)')
  console.log(`ffmpeg: ${file}`)
  if (!problems.length) console.log('OK: LGPL build with soxr')
  else for (const p of problems) console.log(`- ${p}`)
  return problems.length
}

let bad = 0
if (all) {
  const base = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'ffmpeg')
  const targets = existsSync(base) ? readdirSync(base) : []
  if (!targets.length) { console.log(`No builds under ${base}`); process.exit(1) }
  for (const t of targets) for (const n of ['ffmpeg', 'ffmpeg.exe']) if (existsSync(join(base, t, n))) bad += check(join(base, t, n))
} else bad = check(bin)
process.exit(bad && !report ? 1 : 0)
