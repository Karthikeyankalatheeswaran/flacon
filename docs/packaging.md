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
missing, GPL, nonfree or lacks soxr. All four targets (darwin-arm64, darwin-x64, win32-x64, win32-arm64) are built from a single macOS arm64 machine: `scripts/build-ffmpeg.sh` (native arm64) and `scripts/build-ffmpeg-cross.sh <target>` (x64 via `clang -arch`, Windows via the llvm-mingw toolchain; libsoxr built from source as a shared lib). `npm run check:ffmpeg:all` gates every build; for binaries that cannot run on the build host it reads the configure string ffmpeg embeds in itself. Executed-and-tested status: darwin-arm64 (natively), darwin-x64 (under Rosetta, incl. a soxr decode); the Windows binaries are verified only statically (PE type, imports = system DLLs + libsoxr.dll, licence flags) and have never been run. At runtime the app prefers the bundled build, then falls back to the GPL
`ffmpeg-static` for dev only.

## Updates
`electron-updater` is wired (opt-out in Settings → Updates). It is inert in dev and in builds without `app-update.yml`.
Point it at a feed with `-c.publish.url=https://updates.example.com/flacon` (or a GitHub provider) at package time.
macOS auto-update requires a signed + notarized build.

## Building every installer locally
`scripts/package-all.sh [mac-arm64 mac-x64 win-x64 win-arm64]` (default: all four) builds all ffmpeg binaries it needs
(`scripts/build-ffmpeg*.sh`), runs `check:ffmpeg:all`, swaps the Electron-ABI better-sqlite3 per target
(`scripts/rebuild-native.mjs --platform --arch`), packages with electron-builder, and fails if `ffmpeg-static` (GPL) is inside any
app.asar or the bundled ffmpeg is missing. Output in `dist/`:
`Flacon-<v>-mac-{arm64,x64}.{dmg,zip}`, `Flacon-<v>-win-{x64,arm64}-setup.exe`. Windows icon/version resources are edited in pure JS
(`resedit`, `build/afterPack.cjs`) so no wine is needed. Without signing credentials macOS builds are ad-hoc signed
(`npm run check:signing -- --verify` reports this honestly: Gatekeeper rejects, not notarized).

## Status of each platform (honest)
- macOS arm64: packaged app launched from the DMG; 20 E2E tests + axe pass.
- macOS x64: packaged app passes the app E2E suite under Rosetta.
- Windows x64/arm64: installers build and were inspected (correct-arch Flacon.exe, ffmpeg.exe, better_sqlite3.node; icon/version set) but **no Windows binary has ever been executed**. The `release` CI job (windows-latest) installs-and-tests it; run it via `workflow_dispatch` and expect first-run fixes. Unsigned NSIS installers trigger SmartScreen.
- Signing/notarization: not done (needs an Apple Developer ID and an Authenticode certificate). No update feed is configured; the update flow was verified against a local feed through "update ready" only (install/relaunch needs a signed build).
