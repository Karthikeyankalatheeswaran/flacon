// Library data model shared by main, workers and renderers. Milestone 3 fills this from SQLite;
// until then the renderer seeds from `sampleAlbums` (the specimens from design board C4).

export type Quality = 'hires' | 'cd' | 'upscaled' | 'lossy'

export interface Album {
  id: string
  title: string
  artist: string
  /** CSS background for placeholder sleeves; real artwork replaces this at scan time. */
  sleeve: string
  sleeveText?: string
  sleeveTextColor?: string
  bigGlyph?: string
  bigGlyphColor?: string
  quality: Quality
  /** Measured spectral ceiling in kHz (design: "fill line"). */
  ceilingKhz: number
  minutes: number
  offline?: boolean
  tint: string
}

export const CD_LIMIT_KHZ = 22.05

/** Fill-line width: share of the spectrum actually present (design C1). */
export function fillPercent(a: Pick<Album, 'quality' | 'ceilingKhz'>): number {
  if (a.quality === 'hires') return 99
  if (a.quality === 'upscaled') return 41
  if (a.quality === 'lossy') return 33
  return 45.9
}

export function qualityLabel(a: Album): string {
  if (a.offline) return 'Unavailable · drive offline'
  const ceil = `ceiling ${a.ceilingKhz} kHz`
  switch (a.quality) {
    case 'upscaled':
      return `Claims 24/96 · ${ceil}`
    case 'lossy':
      return `AAC 256 · lossy`
    case 'hires':
      return `24 bit · ${ceil}`
    case 'cd':
      return `16/44.1 · ${ceil}`
  }
}

/** m:ss under an hour, h:mm:ss above (handoff: timecodes). */
export function timecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function durationLabel(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes} min`
}

export const sampleAlbums: Album[] = [
  { id: 'a1', title: 'Low Tide Hymns', artist: 'Salt & Ember', quality: 'hires', ceilingKhz: 47.6, minutes: 52, tint: '#13303A',
    sleeve: 'radial-gradient(circle at 68% 38%,#E9C46A 0 11%,transparent 11.5%),linear-gradient(180deg,#1F4250 0 58%,#D9CBB0 58% 59.5%,#16323D 59.5%)',
    sleeveText: 'SALT & EMBER', sleeveTextColor: '#D9CBB0' },
  { id: 'a2', title: '夜の温室', artist: 'Kaito Mori', quality: 'hires', ceilingKhz: 47.9, minutes: 44, tint: '#5A1F37',
    sleeve: 'linear-gradient(#D1497A,#D1497A) 62% 30%/18% 26% no-repeat,repeating-linear-gradient(90deg,rgba(255,255,255,.09) 0 1px,transparent 1px 14%),#0E2A22',
    sleeveText: '夜の温室', sleeveTextColor: 'rgba(255,255,255,.7)' },
  { id: 'a3', title: 'Goldberg Variations, BWV 988', artist: 'J. S. Bach — Mira Solberg', quality: 'hires', ceilingKhz: 95.1, minutes: 78, tint: '#3A3832',
    sleeve: '#EFECE4', bigGlyph: '988', bigGlyphColor: '#141413', sleeveText: 'BACH · SOLBERG', sleeveTextColor: '#141413' },
  { id: 'a4', title: 'Quiet Machines', artist: 'Ines Varga', quality: 'cd', ceilingKhz: 22.05, minutes: 39, tint: '#6B2A12',
    sleeve: 'radial-gradient(circle,#1A1A1A 0 30%,transparent 33%) 0 0/9px 9px,#E8622C' },
  { id: 'a5', title: 'Station to Nowhere', artist: 'Various Artists', quality: 'upscaled', ceilingKhz: 19.8, minutes: 61, tint: '#2C3314',
    sleeve: 'conic-gradient(from 90deg at 40% 60%,#2C2C2C 0 25%,#C8D24A 0 50%,#F1EFE8 0 75%,#5B6B2E 0)' },
  { id: 'a6', title: 'ليالي البحر', artist: 'نور حداد', quality: 'cd', ceilingKhz: 22.05, minutes: 41, tint: '#4A2E12',
    sleeve: '#C9A36A', bigGlyph: 'ل', bigGlyphColor: '#4A2E12', sleeveText: 'نور حداد', sleeveTextColor: '#4A2E12' },
  { id: 'a7', title: 'Field Recordings, Vol. 2', artist: 'Hollow Pines', quality: 'hires', ceilingKhz: 23.9, minutes: 33, tint: '#27414F',
    sleeve: 'radial-gradient(circle at 50% 46%,#F4F4F1 0 18%,transparent 18.5%),repeating-linear-gradient(0deg,#9CB7C9 0 2px,#DCE6EC 2px 9px)' },
  { id: 'a8', title: 'Club Mix 03 (3 h 12 m)', artist: 'DJ Ferro', quality: 'lossy', ceilingKhz: 16, minutes: 192, tint: '#3A0F24',
    sleeve: 'radial-gradient(circle,transparent 0 30%,#FF3D8B 30% 31.5%,transparent 32%),#0A0A0A', sleeveText: 'FERRO / 03', sleeveTextColor: '#FF3D8B' },
  { id: 'a9', title: 'String Quartets 1–15', artist: 'Shostakovich — Halden Quartet', quality: 'hires', ceilingKhz: 47.2, minutes: 401, tint: '#5A1A15',
    sleeve: 'linear-gradient(135deg,transparent 0 48%,#111 48% 60%,transparent 60%),#9E2A22', bigGlyph: '15', bigGlyphColor: '#F1EFE8' },
  { id: 'a10', title: 'track07', artist: 'rips/2003-live', quality: 'cd', ceilingKhz: 22.05, minutes: 47, tint: '#262725',
    sleeve: 'linear-gradient(135deg,#E6E6E2 0 50%,#D2D2CD 50%)', sleeveText: 'TRACK07.FLAC', sleeveTextColor: 'rgba(20,20,19,.55)' },
  { id: 'a11', title: 'Archive Sessions', artist: 'Salt & Ember · NAS offline', quality: 'cd', ceilingKhz: 22.05, minutes: 58, offline: true, tint: '#13303A',
    sleeve: 'linear-gradient(180deg,#1F4250 0 50%,#16323D 50%)', sleeveText: 'ARCHIVE', sleeveTextColor: '#D9CBB0' },
  { id: 'a12', title: 'Pilot Light — Single', artist: 'Salt & Ember', quality: 'hires', ceilingKhz: 47.1, minutes: 5, tint: '#16323D',
    sleeve: 'radial-gradient(circle at 30% 70%,#E9C46A 0 16%,transparent 16.5%),#16323D' }
]
