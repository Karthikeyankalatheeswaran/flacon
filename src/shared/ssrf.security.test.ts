import { describe, expect, it } from 'vitest'
import { checkFetchUrl } from './fetch'
import { lrclibUrl } from './lrclib'

// Evidence for docs/security-review.md: URLs the fetcher and lyrics lookup must refuse (SSRF / local network).
describe('checkFetchUrl refuses local and internal targets however they are spelled', () => {
  const bad = [
    'http://example.com/x', 'ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi',
    'https://localhost/x', 'https://LOCALHOST./x', 'https://foo.localhost/x', 'https://127.0.0.1/x', 'https://127.1/x', 'https://2130706433/x', 'https://0x7f000001/x', 'https://0177.0.0.1/x',
    'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://[::ffff:7f00:1]/x', 'https://[fe80::1]/x', 'https://[fc00::1]/x', 'https://[fd12:3456::1]/x',
    'https://10.0.0.5/x', 'https://172.16.0.1/x', 'https://172.31.255.255/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest/meta-data/', 'https://100.64.0.1/x', 'https://0.0.0.0/x',
    'https://user:pw@example.com/x', 'https://example.com@127.0.0.1/x', 'https://router.local/x', 'https://printer.lan/x', 'https://intranet/x'
  ]
  for (const u of bad) it(`refuses ${u}`, () => expect(checkFetchUrl(u).ok, u).toBe(false))
  it('allows ordinary public https hosts', () => {
    for (const u of ['https://archive.org/download/x/y.flac', 'https://commons.wikimedia.org/w/api.php?x=1', 'https://lrclib.net/api/get?a=b']) expect(checkFetchUrl(u).ok, u).toBe(true)
  })
  it('the lyrics lookup always builds a URL on lrclib.net, whatever the tags say', () => {
    for (const t of ['@127.0.0.1/', '../../x', 'x#@evil.example', '\n\rHost: evil', 'a b%00c']) {
      const u = new URL(lrclibUrl({ artist: t, title: t, album: t, durationSec: 100 })!)
      expect(u.protocol).toBe('https:')
      expect(u.host).toBe('lrclib.net')
      expect(u.pathname).toBe('/api/get')
    }
  })
})

import { checkZipEntry, sanitizeSegment } from './fetch'
describe('file names from the network can never leave the library folder', () => {
  it('sanitizeSegment strips separators, dots and reserved names', () => {
    for (const t of ['../../etc/passwd', '..\\..\\Windows\\system32', '/abs/path', 'a/b', 'CON', 'nul.txt', '....', ' .. ', 'x\u0000y', 'a:b']) {
      const out = sanitizeSegment(t)
      expect(out, t).not.toMatch(/[\\/:\u0000]/)
      expect(out, t).not.toMatch(/^\.+$/)
      expect(out.length).toBeGreaterThan(0)
    }
  })
  it('checkZipEntry refuses traversal, absolute paths and odd names (zip-slip)', () => {
    const entry = (name: string): ReturnType<typeof checkZipEntry> => checkZipEntry({ name, size: 1000, compressed: 900 })
    for (const n of ['../evil.flac', 'a/../../evil.flac', '/etc/passwd.flac', 'C:\\x.flac', '..\\evil.flac', 'a\u0000.flac'])
      expect(entry(n), n).toEqual({ keep: false, reason: 'unsafe' })
    expect(entry('Album/01 One.flac')).toMatchObject({ keep: true, rel: 'Album/01 One.flac' })
    expect(entry('Album/run.exe')).toMatchObject({ keep: false })
  })
})
