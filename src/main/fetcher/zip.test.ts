import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { extractZip } from './zip'

const dir = mkdtempSync(join(tmpdir(), 'flacon-zip-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Python's zipfile lets us write hostile names that `zip` would normalise away.
function makeZip(name: string, entries: Array<[string, string | number]>): string {
  const path = join(dir, name)
  const py = `import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)\nfor n,d in json.loads(sys.argv[2]):\n  z.writestr(n, ('x'*d) if isinstance(d,int) else d)\nz.close()`
  execFileSync('python3', ['-I', '-c', py, path, JSON.stringify(entries)])
  return path
}

describe('extractZip', () => {
  it('extracts audio, art and cue and skips junk', async () => {
    const z = makeZip('mixed.zip', [['Album/01 One.flac', 'AUDIO1'], ['Album/cover.jpg', 'IMG'], ['Album/a.cue', 'CUE'], ['Album/virus.exe', 'MZ'], ['__MACOSX/._01.flac', 'junk']])
    const out = join(dir, 'out1')
    const r = await extractZip(z, out)
    expect(r.files.map((f) => f.slice(out.length + 1)).sort()).toEqual(['Album/01 One.flac', 'Album/a.cue', 'Album/cover.jpg'])
    expect(readFileSync(join(out, 'Album/01 One.flac'), 'utf8')).toBe('AUDIO1')
  })
  it('rejects an archive containing zip-slip paths and writes nothing outside', async () => {
    for (const name of ['../escape.flac', 'a/../../escape2.flac', '/abs/escape3.flac']) {
      const z = makeZip('slip.zip', [['ok.flac', 'fine'], [name, 'EVIL']])
      await expect(extractZip(z, join(dir, 'out-slip'))).rejects.toThrow()
    }
    for (const f of ['escape.flac', 'escape2.flac', 'escape3.flac']) expect(existsSync(join(dir, f))).toBe(false)
    expect(existsSync(join(dir, '..', 'escape.flac'))).toBe(false)
  })
  it('resolves case-insensitive name collisions instead of overwriting', async () => {
    const z = makeZip('case.zip', [['A/Song.flac', 'one'], ['A/song.FLAC', 'two']])
    const out = join(dir, 'out2')
    await extractZip(z, out)
    expect(readdirSync(join(out, 'A')).sort()).toEqual(['Song.flac', 'song (2).FLAC'])
  })
  it('sanitizes hostile segment names (reserved, trailing dots)', async () => {
    const z = makeZip('names.zip', [['CON/aux.flac', 'x'], ['Album. /t.flac', 'y']])
    const out = join(dir, 'out3')
    const r = await extractZip(z, out)
    expect(r.files.map((f) => f.slice(out.length + 1)).sort()).toEqual(['Album/t.flac', '_CON/_aux.flac'])
  })
  it('rejects archives with too many files', async () => {
    const z = makeZip('many.zip', Array.from({ length: 501 }, (_, i): [string, string] => [`t${i}.flac`, 'x']))
    await expect(extractZip(z, join(dir, 'out4'))).rejects.toThrow(/too many/)
  })
  it('skips compression bombs', async () => {
    const z = makeZip('bomb.zip', [['bomb.wav', 60 * 1024 ** 2], ['ok.flac', 'fine']])
    const out = join(dir, 'out5')
    const r = await extractZip(z, out)
    expect(r.skipped).toEqual([{ name: 'bomb.wav', reason: 'ratio' }])
    expect(r.files).toHaveLength(1)
  })
  it('errors cleanly on a file that is not a ZIP', async () => {
    const bad = join(dir, 'bad.zip')
    execFileSync('python3', ['-I', '-c', `open(${JSON.stringify(bad)},'wb').write(b'nope nope nope')`])
    await expect(extractZip(bad, join(dir, 'out6'))).rejects.toThrow()
  })
})
