import { describe, expect, it } from 'vitest'
import { contrast, guardTint } from './tint'
import { albumKey, betterQuality, cleanString, fixMojibake, ftsQuery, hueTint, inferQuality, normalizeTags, splitMulti } from './tags'

describe('cleanString / mojibake', () => {
  it('strips NULs and fixes UTF-8 read as Latin-1', () => {
    expect(cleanString('Caf\u0000é\u0000')).toBe('Café')
    expect(fixMojibake('CafÃ©')).toBe('Café')
    expect(fixMojibake('Ã–ber')).toBe('Öber')
  })
  it('leaves real text alone', () => {
    expect(fixMojibake('夜の温室')).toBe('夜の温室')
    expect(fixMojibake('Ångström')).toBe('Ångström')
    expect(fixMojibake('Ã')).toBe('Ã')
  })
})

describe('tags', () => {
  it('splits multi-value artists but keeps "feat." intact', () => {
    expect(splitMulti(['A; B', 'B', 'C feat. D'])).toEqual(['A', 'B', 'C feat. D'])
  })
  it('falls back to folder and filename for missing tags', () => {
    const n = normalizeTags({}, '/m/rips/2003-live/07 - Opening.flac')
    expect(n).toMatchObject({ title: 'Opening', album: '2003-live', artist: 'Unknown Artist' })
  })
  it('compilation → Various Artists; album artist falls back to first artist', () => {
    expect(normalizeTags({ title: 'x', artist: 'A', compilation: true, album: 'Mix' }, '/a.flac').albumArtist).toBe('Various Artists')
    expect(normalizeTags({ title: 'x', artists: ['A', 'B'], album: 'Z' }, '/a.flac').albumArtist).toBe('A')
  })
})

describe('grouping & quality', () => {
  it('groups case/diacritic variants; quality is not part of the key', () => {
    expect(albumKey('Beyoncé', 'Lemonade')).toBe(albumKey('beyonce', ' LEMONADE '))
  })
  it('prefers the highest quality', () => {
    expect(betterQuality('lossy', 'hires')).toBe('hires')
    expect(betterQuality('cd', 'lossy')).toBe('cd')
  })
  it('infers quality from format', () => {
    expect(inferQuality({ lossless: true, bitDepth: 24, sampleRate: 96000 })).toBe('hires')
    expect(inferQuality({ lossless: true, bitDepth: 16, sampleRate: 44100 })).toBe('cd')
    expect(inferQuality({ lossless: false, bitDepth: null, sampleRate: 44100 })).toBe('lossy')
  })
  it('placeholder tints pass the 4.5:1 guard unchanged', () => {
    for (const k of ['a', 'Low Tide', '夜の温室', 'zzz']) {
      const t = hueTint(k)
      expect(guardTint(t)).toBe(t)
      expect(contrast(t, '#EDEDE8')).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('ftsQuery', () => {
  it('quotes tokens and prefix-matches the last one; cannot inject syntax', () => {
    expect(ftsQuery('low ti')).toBe('"low" "ti"*')
    expect(ftsQuery('a" OR b:* NEAR(')).toBe('"a" "OR" "b" "NEAR"*')
    expect(ftsQuery('   ')).toBe('')
  })
})
