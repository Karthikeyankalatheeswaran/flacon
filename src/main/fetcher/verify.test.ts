import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyFlac } from './verify'

const ff = ffmpegPath as string
const dir = mkdtempSync(join(tmpdir(), 'flacon-verify-'))
const f = (n: string): string => join(dir, n)
const make = (out: string, filter: string, extra: string[] = []): void =>
  void execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=8:c=white:r=44100:a=0.3', '-af', filter, ...extra, f(out)])

describe('verifyFlac (real ffmpeg)', () => {
  beforeAll(() => {
    make('clean.flac', 'anull', ['-sample_fmt', 's16'])
    make('lossy-like.flac', 'lowpass=f=16000,lowpass=f=16000,lowpass=f=16000,lowpass=f=16000', ['-sample_fmt', 's16'])
    make('fake24.flac', 'anull', ['-sample_fmt', 's16', '-c:a', 'flac']) // 16-bit data…
    execFileSync(ff, ['-v', 'error', '-y', '-i', f('fake24.flac'), '-sample_fmt', 's32', '-bits_per_raw_sample', '24', f('fake24b.flac')]) // …in a 24-bit container
    const buf = readFileSync(f('clean.flac'))
    for (let i = 20000; i < 20064; i++) buf[i] = buf[i]! ^ 0xff
    writeFileSync(f('corrupt.flac'), buf)
  }, 60000)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('passes a clean file: decodes, MD5 matches, nothing to report', async () => {
    const r = await verifyFlac(f('clean.flac'), ff)
    expect(r).toMatchObject({ decodeOk: true, md5: 'match', upscaled: false, fakeBitDepth: false, notes: [] })
    expect(r!.info).toMatchObject({ sampleRate: 44100, bitsPerSample: 16 })
  }, 30000)
  it('flags content that stops at 16 kHz', async () => {
    const r = await verifyFlac(f('lossy-like.flac'), ff)
    expect(r!.upscaled).toBe(true)
    expect(r!.notes.join(' ')).toMatch(/16/)
  }, 30000)
  it('flags 16-bit data in a 24-bit container', async () => {
    const r = await verifyFlac(f('fake24b.flac'), ff)
    expect(r!.info.bitsPerSample).toBe(24)
    expect(r!.fakeBitDepth).toBe(true)
  }, 30000)
  it('detects damage (decode error or checksum mismatch)', async () => {
    const r = await verifyFlac(f('corrupt.flac'), ff)
    expect(r!.decodeOk === false || r!.md5 === 'mismatch').toBe(true)
  }, 30000)
  it('returns null for non-FLAC input', async () => {
    writeFileSync(f('x.flac'), 'not audio at all, just some text bytes padding padding padding')
    expect(await verifyFlac(f('x.flac'), ff)).toBeNull()
  })
})
