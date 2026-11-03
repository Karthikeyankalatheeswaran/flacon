import { describe, expect, it } from 'vitest'
import { groupLevel, likeUnder, parentDir, sepOf, type FolderTrack } from './folders'

const t = (path: string, id = 1): FolderTrack => ({ id, path, title: path, artist: '', durationSec: 1 })

describe('groupLevel', () => {
  const rows = [t('/m/A/1.flac', 1), t('/m/A/2.flac', 2), t('/m/A/CD2/1.flac', 3), t('/m/B/x.flac', 4), t('/m/top.flac', 5), t('/m2/other.flac', 6)]
  it('splits one level into sub-folders and direct tracks, ignoring siblings with the same prefix', () => {
    const r = groupLevel('/m', rows)
    expect(r.dirs).toEqual([{ name: 'A', path: '/m/A', tracks: 3 }, { name: 'B', path: '/m/B', tracks: 1 }])
    expect(r.tracks.map((x) => x.id)).toEqual([5])
  })
  it('descends and sorts naturally', () => {
    const r = groupLevel('/m/A', [t('/m/A/10.flac', 1), t('/m/A/2.flac', 2)])
    expect(r.tracks.map((x) => x.id)).toEqual([2, 1])
  })
  it('handles Windows separators', () => {
    expect(sepOf('C:\\Music\\A')).toBe('\\')
    const r = groupLevel('C:\\Music', [t('C:\\Music\\A\\1.flac'), t('C:\\Music\\2.flac', 2)])
    expect(r.dirs).toEqual([{ name: 'A', path: 'C:\\Music\\A', tracks: 1 }])
    expect(r.tracks).toHaveLength(1)
  })
})
describe('helpers', () => {
  it('parentDir stops at library roots', () => {
    expect(parentDir('/m/A/CD2', ['/m'])).toBe('/m/A')
    expect(parentDir('/m', ['/m'])).toBeNull()
  })
  it('likeUnder escapes wildcards', () => {
    expect(likeUnder('/m/100%_x')).toBe('/m/100\\%\\_x/%')
  })
})
