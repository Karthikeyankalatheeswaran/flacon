# Packaging, signing and updates

## Local unsigned build (macOS arm64)
`npm run package:dir` → `dist/mac-arm64/Flacon.app` (ad-hoc signed so it launches locally). Run the same E2E suite against it:
`E2E_APP=dist/mac-arm64/Flacon.app/Contents/MacOS/Flacon npx vitest run --config vitest.e2e.config.ts`

## Release build
`npm run package` runs the ffmpeg licence gate, then electron-builder (mac dmg+zip arm64/x64, Windows NSIS x64/arm64).
Native `.node` files and ffmpeg are `asarUnpack`ed; `npmRebuild` is off because `rebuild:native` already built the Electron ABI.

## Signing (all from the environment — never commit these)
- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD` (Developer ID .p12), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; enable notarization with `-c.mac.notarize=true`. Hardened runtime + `build/entitlements.mac.plist` are already set.
- Windows: `CSC_LINK`/`CSC_KEY_PASSWORD` (Authenticode) or Azure Trusted Signing via electron-builder config.

## ffmpeg licence (blocking for release)
`ffmpeg-static` is a GPL + nonfree build with no libsoxr. Before shipping, replace it with an **LGPL** build that has `libsoxr`
(dynamic link, source offer) and keep `npm run check:ffmpeg` green. `check:ffmpeg --report` prints the build flags without failing.

## Updates
`electron-updater` is wired (opt-out in Settings → Updates). It is inert in dev and in builds without `app-update.yml`.
Point it at a feed with `-c.publish.url=https://updates.example.com/flacon` (or a GitHub provider) at package time.
macOS auto-update requires a signed + notarized build.
