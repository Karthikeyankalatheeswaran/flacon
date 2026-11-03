#!/usr/bin/env bash
# End-to-end test of the updater on macOS arm64 using a local HTTP feed: builds v0.1.0 (the app under test) and v0.1.1 (the update),
# serves v0.1.1's zip + latest-mac.yml on 127.0.0.1, then drives the older app through check -> download -> "ready".
# Does NOT test the final install/relaunch step: Squirrel.Mac only applies updates signed with a real Developer ID.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=4873; FEED="http://127.0.0.1:$PORT"; T=$(mktemp -d)
trap 'kill $SRV 2>/dev/null || true; rm -rf "$T" dist' EXIT
PUB=(-c.publish.provider=generic "-c.publish.url=$FEED" -c.mac.identity=null)
npx electron-vite build >/dev/null
echo "== building v0.1.0 (app under test)"
# not --dir: electron-builder only writes app-update.yml (the feed config) when building a real target
npx electron-builder --mac zip --arm64 "${PUB[@]}" >/dev/null
codesign --force --deep -s - dist/mac-arm64/Flacon.app
mv dist/mac-arm64/Flacon.app "$T/Flacon.app"; rm -rf dist
echo "== building v0.1.1 (the update)"
npx electron-builder --mac zip --arm64 "${PUB[@]}" -c.extraMetadata.version=0.1.1 >/dev/null
mkdir "$T/feed"; cp dist/*.zip dist/*.blockmap dist/latest-mac.yml "$T/feed/"; rm -rf dist
cat "$T/feed/latest-mac.yml"
python3 -m http.server $PORT --bind 127.0.0.1 -d "$T/feed" >/dev/null 2>&1 & SRV=$!
sleep 1
E2E_UPDATE_APP="$T/Flacon.app/Contents/MacOS/Flacon" npx vitest run --config vitest.e2e.config.ts e2e/update.e2e.ts
