import { describe, expect, it } from 'vitest'
import { isTrustedUrl } from './security'

const dir = 'file:///Applications/Flacon.app/Contents/Resources/app.asar/out/renderer'
describe('isTrustedUrl', () => {
  it('accepts our own pages', () => {
    for (const p of ['index', 'island', 'mini', 'engine']) expect(isTrustedUrl(`${dir}/${p}.html`, dir)).toBe(true)
    expect(isTrustedUrl(`${dir}/index.html?x=1#y`, dir)).toBe(true)
  })
  it('accepts the dev server origin only when one is configured', () => {
    expect(isTrustedUrl('http://localhost:5173/index.html', dir, 'http://localhost:5173')).toBe(true)
    expect(isTrustedUrl('http://localhost:5173/index.html', dir)).toBe(false)
    expect(isTrustedUrl('http://localhost:9999/index.html', dir, 'http://localhost:5173')).toBe(false)
  })
  it('refuses everything else', () => {
    for (const u of ['', 'about:blank', 'data:text/html,<script>1</script>', 'https://evil.example/index.html', 'file:///tmp/evil.html', `${dir}/../../evil.html`, `${dir}/assets/x.html`, `${dir}-evil/index.html`, 'flacon-art://art/x.png', 'javascript:alert(1)'])
      expect(isTrustedUrl(u, dir), u).toBe(false)
  })
})
