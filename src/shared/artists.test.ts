import { describe, expect, it } from 'vitest'
import { groupArtists } from './artists'
import type { Album } from './library'

const al = (id: string, artist: string, trackCount = 10): Album => ({ id, title: id, artist, sleeve: '', quality: 'cd', ceilingKhz: 22, minutes: 1, tint: '#000', trackCount })

describe('groupArtists', () => {
  it('merges case/accent variants, counts tracks, sorts A–Z with Various Artists last', () => {
    const g = groupArtists([al('1', 'Zed'), al('2', 'Beyoncé'), al('3', 'beyonce', 5), al('4', 'Various Artists'), al('5', '')])
    expect(g.map((x) => x.name)).toEqual(['Beyoncé', 'Unknown artist', 'Zed', 'Various Artists'])
    expect(g[0]).toMatchObject({ tracks: 15 })
    expect(g[0]!.albums).toHaveLength(2)
  })
})
