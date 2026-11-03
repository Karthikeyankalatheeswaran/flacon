import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast } from './tint'

// Audit of the shipped colour tokens: text colours must reach WCAG AA (4.5:1) on the surfaces they sit on.
const css = readFileSync(new URL('../renderer/src/styles/tokens.css', import.meta.url), 'utf8')

function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css)!
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+?)\s*(?:\/\*.*?\*\/)?;/g)].map((x) => [x[1]!, x[2]!]))
}
const light = block(/:root,\s*\[data-theme='light'\]\s*\{/)
const dark = { ...light, ...block(/\[data-theme='dark'\]\s*\{/) }

const hex = (n: number[]): string => '#' + n.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
function rgb(v: string): number[] {
  const h = /^#([0-9a-f]{6})$/i.exec(v)
  if (h) return [0, 2, 4].map((i) => parseInt(h[1]!.slice(i, i + 2), 16))
  const f = /^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/.exec(v)!
  return [+f[1]!, +f[2]!, +f[3]!, f[4] ? +f[4] : 1]
}
/** Resolve a (possibly translucent) colour over an opaque background to a hex. */
function over(fg: string, bg: string): string {
  const [r, g, b, a = 1] = rgb(fg)
  const [br, bgc, bb] = rgb(bg)
  return hex([r! * a + br! * (1 - a), g! * a + bgc! * (1 - a), b! * a + bb! * (1 - a)])
}

describe.each([['light', light], ['dark', dark]] as const)('%s theme contrast (AA 4.5:1)', (_n, t) => {
  for (const surface of ['bg', 'sheet', 'well'] as const) {
    for (const ink of ['ink', 'ink-2'] as const) {
      it(`${ink} on ${surface}`, () => expect(contrast(over(t[ink]!, t[surface]!), t[surface]!)).toBeGreaterThanOrEqual(4.5))
    }
  }
  for (const c of ['ok', 'warn', 'err', 'tint-ink'] as const) {
    it(`${c} text on bg`, () => expect(contrast(t[c]!, t['bg']!)).toBeGreaterThanOrEqual(4.5))
    it(`${c} text on sheet`, () => expect(contrast(t[c]!, t['sheet']!)).toBeGreaterThanOrEqual(4.5))
  }
})
