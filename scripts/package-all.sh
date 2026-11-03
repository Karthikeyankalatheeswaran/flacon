#!/usr/bin/env bash
# Builds installers for every target from one macOS arm64 machine:
#   Flacon-<v>-mac-arm64.dmg, Flacon-<v>-mac-x64.dmg, Flacon-<v>-win-x64-setup.exe, Flacon-<v>-win-arm64-setup.exe (+ update zips/yml).
# Per target it swaps in that platform's Electron-ABI better-sqlite3 binary, and deletes the unpacked app afterwards to save disk.
# Unsigned unless the signing variables are present (see docs/packaging.md). Usage: scripts/package-all.sh [mac-arm64 mac-x64 win-x64 win-arm64]
set -euo pipefail
cd "$(dirname "$0")/.."
TARGETS=${*:-mac-arm64 mac-x64 win-x64 win-arm64}
EXTRA=()
[ -z "${CSC_LINK:-}" ] && EXTRA+=(-c.mac.identity=null)
node scripts/check-ffmpeg-license.mjs --all
npx electron-vite build >/dev/null
trap 'node scripts/rebuild-native.mjs >/dev/null 2>&1 || true' EXIT   # leave dev with this machine's binary
for t in $TARGETS; do
  case $t in
    mac-arm64) P=darwin; A=arm64; F=(--mac dmg zip) ;;
    mac-x64)   P=darwin; A=x64;   F=(--mac dmg zip) ;;
    win-x64)   P=win32;  A=x64;   F=(--win nsis) ;;
    win-arm64) P=win32;  A=arm64; F=(--win nsis) ;;
    *) echo "unknown target $t" >&2; exit 2 ;;
  esac
  echo "=== $t"
  node scripts/rebuild-native.mjs --platform $P --arch $A >/dev/null
  npx electron-builder "${F[@]}" --$A "${EXTRA[@]}" >/dev/null
  # Guard: the GPL dev-only ffmpeg must not be inside any shipped app, and the LGPL one must be.
  for asar in dist/mac*/Flacon.app/Contents/Resources/app.asar dist/win*-unpacked/resources/app.asar; do
    [ -f "$asar" ] || continue
    if npx asar list "$asar" | grep -qi 'ffmpeg-static'; then echo "FATAL: ffmpeg-static (GPL) is inside $asar" >&2; exit 1; fi
    res=$(dirname "$asar"); ls "$res"/ffmpeg/ffmpeg* >/dev/null 2>&1 || { echo "FATAL: bundled ffmpeg missing in $res" >&2; exit 1; }
    echo "guard ok: $asar"
  done
  rm -rf dist/mac dist/mac-arm64 dist/mac-universal dist/win-unpacked dist/win-arm64-unpacked
done
ls -la dist/*.dmg dist/*.exe dist/*.zip 2>/dev/null
