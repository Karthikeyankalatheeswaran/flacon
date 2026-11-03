// Signing readiness + verification. Never prints secret values.
//   node scripts/check-signing.mjs --env              all signing variables present? (exit 1 if not)
//   node scripts/check-signing.mjs --verify Flacon.app   what is this build really: ad-hoc, Developer ID, notarized?
import { execFileSync, spawnSync } from 'node:child_process'

const [mode, target] = process.argv.slice(2)

if (mode === '--env') {
  const need = { CSC_LINK: 'Developer ID / Authenticode certificate (.p12 path or base64)', CSC_KEY_PASSWORD: 'its password', APPLE_ID: 'Apple ID used for notarization', APPLE_APP_SPECIFIC_PASSWORD: 'app-specific password for that Apple ID', APPLE_TEAM_ID: '10-character Apple team id' }
  const missing = Object.keys(need).filter((k) => !process.env[k])
  for (const [k, why] of Object.entries(need)) console.log(`${process.env[k] ? 'set    ' : 'MISSING'}  ${k}  (${why})`)
  process.exit(missing.length ? 1 : 0)
}

if (mode === '--verify' && target) {
  const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` } }
  const strict = sh('codesign', ['--verify', '--deep', '--strict', target])
  const info = sh('codesign', ['-dvv', target]).out
  const adhoc = /Signature=adhoc/.test(info)
  const authority = /Authority=Developer ID Application: [^\n]+/.exec(info)?.[0]
  const team = /TeamIdentifier=(\S+)/.exec(info)?.[1]
  const gatekeeper = sh('spctl', ['--assess', '--type', 'execute', '-vv', target])
  const stapled = sh('xcrun', ['stapler', 'validate', target]).ok
  console.log(`structure valid : ${strict.ok ? 'yes' : 'NO — ' + strict.out.trim().split('\n')[0]}`)
  console.log(`signature       : ${adhoc ? 'ad-hoc (no identity)' : authority ?? 'unknown'}${team && team !== 'not' ? `  team ${team}` : ''}`)
  console.log(`Gatekeeper      : ${gatekeeper.ok ? 'accepted' : 'REJECTED — ' + gatekeeper.out.trim().split('\n')[0]}`)
  console.log(`notarized+stapled: ${stapled ? 'yes' : 'no'}`)
  const shippable = strict.ok && !!authority && gatekeeper.ok && stapled
  console.log(shippable ? 'RESULT: distributable' : 'RESULT: NOT distributable to other Macs without warnings (local testing only)')
  process.exit(shippable ? 0 : 1)
}

console.error('usage: check-signing.mjs --env | --verify <path/to/Flacon.app>')
process.exit(2)
