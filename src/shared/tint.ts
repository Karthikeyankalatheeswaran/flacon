// Tint contrast guard (design C1): a sleeve colour is only allowed on screen once it holds
// 4.5:1 against chalk text. If it fails we darken the tint, never the text.

const CHALK = '#EDEDE8'

function lin(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

/** Darken `hex` toward black in 4% steps until it clears `min` against chalk. */
export function guardTint(hex: string, min = 4.5): string {
  let rgb = parseHex(hex)
  for (let i = 0; i < 40 && contrast(toHex(rgb), CHALK) < min; i++) {
    rgb = [rgb[0] * 0.96, rgb[1] * 0.96, rgb[2] * 0.96]
  }
  return toHex(rgb)
}
