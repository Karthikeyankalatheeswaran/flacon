// Renders build/icon.svg to build/icon.png (1024, transparent corners) using Electron itself. Run: npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage()
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
