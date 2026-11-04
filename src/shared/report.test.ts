import { describe, expect, it } from 'vitest'
import { buildReport, redact } from './report'

describe('redact', () => {
  it('removes the home folder in either slash style, e-mails and tokens', () => {
    const out = redact('open /Users/ann/Music/x failed; C:\\Users\\ann\\a ann@example.com key=abcdefghijklmnopqrstuvwxyz0123456789ABCD', '/Users/ann', 'ann')
    expect(out).not.toContain('ann@')
    expect(out).not.toContain('/Users/ann')
    expect(out).not.toMatch(/abcdefghijklmnopqrstuvwxyz/)
    expect(out).toContain('<email>')
    expect(out).toContain('<token>')
  })
  it('keeps only the file name of music paths', () => {
    const out = redact('cannot decode /Volumes/NAS/Audio/Jazz/Miles Davis/Kind of Blue/01 So What.flac now', '/Users/x')
    expect(out).toContain('<music>/01 So What.flac')
    expect(out).not.toContain('Miles Davis')
  })
  it('drops URL query strings', () => {
    expect(redact('GET https://api.example.com/v1/x?client_id=SECRET&q=hi failed', '/Users/x')).toBe('GET https://api.example.com/v1/x?<query> failed')
  })
  it('does not mangle ordinary text', () => {
    expect(redact('Decoder exited with code 1 after 3.2 s', '/Users/x')).toBe('Decoder exited with code 1 after 3.2 s')
  })
})

describe('buildReport', () => {
  const base = { version: '0.4.0', platform: 'darwin', osVersion: '25.1', arch: 'arm64', electron: '33', chrome: '130', node: '20', settings: { theme: 'dark', crossfade: 3 }, log: ['a', 'b'], crashDumps: 0, note: 'It stopped', home: '/Users/ann', user: 'ann', now: new Date('2026-11-04T00:00:00Z') }
  it('contains the facts a developer needs and the user\'s note', () => {
    const r = buildReport(base)
    expect(r).toContain('Flacon 0.4.0')
    expect(r).toContain('It stopped')
    expect(r).toContain('crossfade: 3')
    expect(r).toContain('2026-11-04T00:00:00.000Z')
  })
  it('redacts the note and the log too, and caps their length', () => {
    const r = buildReport({ ...base, note: 'mail me ann@example.com', log: Array.from({ length: 500 }, (_, i) => `line ${i} /Users/ann/x`) })
    expect(r).not.toContain('ann@example.com')
    expect(r).not.toContain('/Users/ann')
    expect(r).toContain('line 499')
    expect(r).not.toContain('line 100 ')
  })
})
