import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REFUSED_INPUT, inputArgs, isPlainLocalPath } from './ffmpegSafe'

const dir = mkdtempSync(join(tmpdir(), 'flacon-safe-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const ff = ffmpegPath as string
const decode = (path: string): { ok: boolean; stderr: string } => {
  const r = spawnSync(ff, ['-v', 'error', '-nostdin', ...inputArgs(path), '-t', '1', '-f', 'null', '-'], { encoding: 'utf8', timeout: 15000 })
  return { ok: r.status === 0, stderr: r.stderr }
}

describe('isPlainLocalPath', () => {
  it('accepts absolute local paths', () => {
    for (const p of ['/Users/a/Music/x.flac', 'C:\\Music\\x.flac', 'C:/Music/x.flac', '\\\\nas\\music\\x.flac']) expect(isPlainLocalPath(p), p).toBe(true)
  })
  it('refuses URLs, relative paths, options and control characters', () => {
    for (const p of ['http://evil/x.flac', 'https://evil/x.flac', 'file:///etc/passwd', 'rtmp://h/x.flac', 'x.flac', '../x.flac', '-i', 'concat:/a|/b', '/a/b\u0000.flac', '/a/b\n.flac', '']) expect(isPlainLocalPath(p), JSON.stringify(p)).toBe(false)
  })
  it('refused paths are swapped for one that cannot exist', () => {
    expect(inputArgs('http://evil/x.flac').at(-1)).toBe(REFUSED_INPUT)
    expect(inputArgs('/ok/x.flac').at(-1)).toBe('/ok/x.flac')
  })
})

describe('ffmpeg input hardening (real ffmpeg)', () => {
  beforeAll(() => {
    // Real music containers must still decode.
    for (const [name, args] of [['a.flac', []], ['a.wav', []], ['a.aiff', []], ['a.ogg', ['-c:a', 'libvorbis']], ['a.mp3', ['-c:a', 'libmp3lame']], ['a.m4a', ['-c:a', 'aac']], ['a.mka', ['-c:a', 'flac']], ['a.opus', ['-c:a', 'libopus']]] as const)
      try { execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2:r=48000', ...args, join(dir, name)]) } catch { /* encoder missing in this ffmpeg build: that format is skipped below */ }
  })
  for (const f of ['a.flac', 'a.wav', 'a.aiff', 'a.ogg', 'a.mp3', 'a.m4a', 'a.mka', 'a.opus']) {
    it(`still plays ${f}`, (ctx) => {
      const r = decode(join(dir, f))
      if (!r.ok && /No such file/.test(r.stderr)) return ctx.skip() // that encoder is not in this ffmpeg build
      expect(r.stderr).toBe('')
      expect(r.ok).toBe(true)
    })
  }
  it('refuses an HLS playlist disguised as a .flac', () => {
    writeFileSync(join(dir, 'evil-hls.flac'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\nhttp://127.0.0.1:9/seg.ts\n#EXT-X-ENDLIST\n')
    expect(decode(join(dir, 'evil-hls.flac')).ok).toBe(false)
  })
  it('refuses a concat script disguised as a .wav', () => {
    writeFileSync(join(dir, 'evil-concat.wav'), `ffconcat version 1.0\nfile '${join(dir, 'a.flac')}'\n`)
    expect(decode(join(dir, 'evil-concat.wav')).ok).toBe(false)
  })
  it('refuses to open a network URL', () => {
    expect(decode('http://127.0.0.1:9/x.flac').ok).toBe(false)
  })
})
