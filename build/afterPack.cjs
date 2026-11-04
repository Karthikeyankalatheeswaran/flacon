// electron-builder hook, run after the app is laid out and before it is signed/packed.
//  - macOS without a signing identity: ad-hoc sign so the build launches on Apple Silicon (local/testing only, not distributable).
//  - Windows: set the exe icon and version info in pure JS (resedit), because electron-builder needs wine for that off Windows.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// Electron "fuses" are switches burned into the binary. Turning off what Flacon never uses removes whole attack
// paths: no ELECTRON_RUN_AS_NODE shell, no NODE_OPTIONS, no --inspect, and the app code may only come from app.asar.
async function hardenFuses(ctx, name) {
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
  const target = ctx.electronPlatformName === 'darwin' ? path.join(ctx.appOutDir, `${name}.app`) : path.join(ctx.appOutDir, `${name}.exe`)
  await flipFuses(target, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: ctx.electronPlatformName === 'darwin' && ctx.arch === 3 /* arm64 */,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
}

module.exports = async function afterPack(ctx) {
  const name = ctx.packager.appInfo.productFilename
  if (ctx.electronPlatformName === 'darwin' || ctx.electronPlatformName === 'win32') await hardenFuses(ctx, name)
  if (ctx.electronPlatformName === 'darwin' && !process.env.CSC_LINK && !process.env.CSC_NAME) {
    execFileSync('codesign', ['--force', '--deep', '-s', '-', path.join(ctx.appOutDir, `${name}.app`)], { stdio: 'inherit' })
  }
  if (ctx.electronPlatformName === 'win32') {
    const R = await import('resedit')
    const file = path.join(ctx.appOutDir, `${name}.exe`)
    const exe = R.NtExecutable.from(fs.readFileSync(file))
    const res = R.NtExecutableResource.from(exe)
    const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')))
    const group = res.entries.find((e) => e.type === 14) // RT_GROUP_ICON of the stock Electron exe
    R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group ? group.id : 1, group ? group.lang : 1033, ico.icons.map((i) => i.data))
    const [vi] = R.Resource.VersionInfo.fromEntries(res.entries)
    const v = ctx.packager.appInfo.version.split('.').map(Number)
    vi.setFileVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0)
    vi.setProductVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0)
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: name, FileDescription: name, InternalName: name, OriginalFilename: `${name}.exe`,
      CompanyName: 'Flacon contributors', LegalCopyright: ctx.packager.appInfo.copyright || 'Copyright © Flacon contributors'
    })
    vi.outputToResourceEntries(res.entries)
    res.outputResource(exe)
    fs.writeFileSync(file, Buffer.from(exe.generate()))
  }
}
