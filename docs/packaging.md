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
The app bundles its own decode-only **LGPL-2.1** ffmpeg (no `--enable-gpl`/`--enable-nonfree`) with **libsoxr** resampling, built by
`scripts/build-ffmpeg.sh` into `vendor/ffmpeg/<platform>-<arch>/` (git-ignored) and shipped via `extraResources` as `Resources/ffmpeg/`.
libsoxr (LGPL) is dynamically linked (`libsoxr.0.dylib` beside the binary) so it can be replaced. Source is unmodified ffmpeg from ffmpeg.org;
ship the licence texts and a source offer in the release notes. `npm run check:ffmpeg` is the release gate and fails if the bundled binary is
missing, GPL, nonfree or lacks soxr. Only macOS arm64 has been built so far: x64 needs the script run on an Intel Mac (or cross-built) and Windows
needs the same configure flags under MSYS2 into `vendor/ffmpeg/win32-<arch>/`. At runtime the app prefers the bundled build, then falls back to the GPL
`ffmpeg-static` for dev only.

## Updates
`electron-updater` is wired (opt-out in Settings → Updates). It is inert in dev and in builds without `app-update.yml`.
Point it at a feed with `-c.publish.url=https://updates.example.com/flacon` (or a GitHub provider) at package time.
macOS auto-update requires a signed + notarized build.

## Windows
Windows x64 is prepared but **has never been run** (all work so far was on macOS). `scripts/build-ffmpeg-win.sh` (MSYS2 MINGW64) builds the same LGPL+soxr ffmpeg into `vendor/ffmpeg/win32-x64/`;
the `release` CI job builds it, runs the gate, packages the NSIS installer and runs the E2E suite against `dist/win-unpacked/Flacon.exe`. Trigger it with `workflow_dispatch`; expect to fix first-run issues.
arm64 (Windows and macOS x64) targets are removed from `electron-builder.yml` until their ffmpeg binaries exist. Unsigned NSIS installers trigger SmartScreen warnings.
