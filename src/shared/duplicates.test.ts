import { describe, expect, it } from 'vitest'
import { findDuplicates, normName, safeToTrash, type DupRow } from './duplicates'

const row = (o: Partial<DupRow>): DupRow => ({ path: '/m/a.flac', title: 'Undertow', artist: 'Halden', album: 'A', durationSec: 380, codec: 'flac', sampleRate: 44100, bitDepth: 16, size: 30e6, lossless: true, purity: null, dr: null, ...o })

describe('findDuplicates', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normName('Café — Del Mar!')).toBe(normName('cafe del mar'))
  })
  it('groups the same song across albums and ranks the best copy first', () => {
    const g = findDuplicates([
      row({ path: '/m/mp3.mp3', codec: 'mp3', lossless: false, bitDepth: null, size: 9e6, durationSec: 380.4 }),
      row({ path: '/m/hires.flac', sampleRate: 96000, bitDepth: 24, size: 90e6 }),
      row({ path: '/m/cd.flac', album: 'Greatest Hits' }),
      row({ path: '/m/other.flac', title: 'Different' })
    ])
    expect(g).toHaveLength(1)
    expect(g[0]!.members.map((m) => m.path)).toEqual(['/m/hires.flac', '/m/cd.flac', '/m/mp3.mp3'])
  })
  it('keeps live/long versions with a very different length apart', () => {
    expect(findDuplicates([row({ path: '/a' }), row({ path: '/b', durationSec: 521 })])).toHaveLength(0)
  })
  it('never groups songs with no title', () => {
    expect(findDuplicates([row({ title: '', path: '/a' }), row({ title: '', path: '/b' })])).toHaveLength(0)
  })
})

describe('safeToTrash', () => {
  const groups = findDuplicates([row({ path: '/best', sampleRate: 96000, bitDepth: 24 }), row({ path: '/mid' }), row({ path: '/low', codec: 'mp3', lossless: false, bitDepth: null })])
  it('allows trashing extras', () => {
    expect(safeToTrash(groups, ['/mid', '/low']).sort()).toEqual(['/low', '/mid'])
  })
  it('always spares one copy, even if every copy is ticked', () => {
    const out = safeToTrash(groups, ['/best', '/mid', '/low'])
    expect(out).not.toContain('/best')
    expect(out).toHaveLength(2)
  })
  it('refuses paths that are not duplicates', () => {
    expect(safeToTrash(groups, ['/etc/passwd', '/unrelated.flac'])).toEqual([])
  })
})
