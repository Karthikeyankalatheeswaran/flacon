# Flacon

Lossless, bottled. Electron music player built from design **Direction C — Instrument** (claude.ai design canvas, boards C1–C14).

## Milestone 1 — scaffold, security baseline, tokens, shell (this commit)

- `src/shared` — zod IPC schemas, island state machine (reducer), tint contrast guard, library model. Unit-tested (`npm test`).
- `src/main` — single-instance lock, hide-on-close, CSP + permission denial, navigation/new-window lockdown, `shell.openExternal` allowlist, island window (non-activating panel, click-through, re-places on display changes, notch detection).
- `src/preload` — minimal typed `contextBridge` surface.
- `src/renderer` — design tokens as CSS variables (`styles/tokens.css`), shell (rail · main · vessel), album grid with fill lines and drag-to-pour, island view with spring morphs.

### Run
```bash
npm run dev:web   # renderer in a browser, mock bridge, no Electron binary needed
npm run dev       # full Electron app (needs the Electron binary: `npm rebuild electron`)
npm run typecheck && npm test
```

### Decisions
- Archivo is not bundled yet (add `@fontsource-variable/archivo` before shipping); falls back to the system UI font.
- Island pill animates `width/height/border-radius` with a spring inside a fixed-size transparent window, as in the design's morph spec. Native window bounds never animate.
- Electron binary, better-sqlite3, chokidar, electron-store, electron-updater are deferred to the milestones that need them.

## Milestone 2 — audio engine (verified in real Electron)

Pipeline: UI/tray/OS → main (zod-validated `PlaybackCommand`) → hidden **engine window** → **decoder utilityProcess** (ffmpeg → f32le PCM chunks over a MessagePort, credit-based backpressure, ~10 s ahead) → **AudioWorklet ring-buffer player** → output.

- Gapless: next track is pre-decoded 15 s before the end and its samples follow the current track in the ring; the worklet marks track boundaries by absolute frame. Verified 24/96 → 16/44.1 with no gap.
- Seek = new decode from the target with a 10 ms fade-out/flush/fade-in. Volume is a −60…0 dB perceptual curve in the float domain (0 = silence, distinct from mute).
- Corrupt/empty files are skipped with a toast; decoder crash respawns and re-links.
- Device routing via `AudioContext.setSinkId`; on disconnect of the active device: pause, toast, fall back to default.
- `navigator.mediaSession` (+ silent looping `<audio>` keepalive so Chromium registers the session) for media keys / Now Playing / SMTC.
- Main: tray / menu-bar extra, Dock menu, Windows thumbnail toolbar, `powerSaveBlocker` while playing, pause on suspend, AudioContext recovery on resume/unlock, file args + `open-file`.
- Debug: `FLACON_LOG_STATE=1` prints engine state from main (used for smoke tests).

Known gaps / decisions: `ffmpeg-static` is a GPL/nonfree build without soxr — fine for development, must be replaced by an LGPL build (with soxr) before shipping. "Match source" rate and encoder delay/padding trimming, crossfade, ReplayGain, EQ are not implemented yet. MessagePortMain structured-clones (not transfers) ArrayBuffers. Not yet audibly/aurally verified; no seek/device/sleep-wake automated tests (Playwright suite comes with M8).

## Milestone 3 — library (verified in real Electron against a fixture library)

`library worker (utilityProcess)` owns SQLite (better-sqlite3, WAL, `user_version` migrations, corrupt DB moved aside and rebuilt), scanning, tag parsing (music-metadata), artwork and watching (chokidar). Main only proxies zod-validated requests; the renderer gets albums via the bridge and artwork through the `flacon-art://` protocol (hashed filenames only).

- Incremental scan: walk → stat (size+mtime) → parse → upsert, batched in transactions, progress streamed to the rail. Skips hidden/AppleDouble files, corrupt files and non-audio; symlink loops and the same file via two paths are deduplicated; unreadable folders are reported ("Allow access in System Settings"); an unreachable root marks its albums offline instead of deleting them.
- Tags: NUL/control stripping, mojibake repair (UTF-8 read as Latin-1/CP1252), multi-value artists, Album Artist / compilation → Various Artists, disc/track totals, missing tags fall back to folder/filename. Duplicate albums in different qualities group into one and show the highest quality.
- Artwork: embedded first, then `cover|folder|front|album.{jpg,png,webp}`; >20 MB embedded art ignored; stored content-addressed.
- Watching: debounced, awaits write-finish, moves/renames keep track identity (size+duration+tags), symlinks not followed.
- Search: FTS5, `unicode61 remove_diacritics 2`, user input tokenised and quoted (no syntax injection), last token prefix-matched, latest-wins in the UI.
- UI: virtualised album grid (TanStack Virtual), skeletons, empty/searching/no-results states, double-click or Enter plays an album.

`npm run rebuild:native` fetches the Electron-ABI binary of better-sqlite3 (pinned to 11.x: 13.x prebuilds segfault on Electron 33). `FLACON_LIBRARY_FOLDER=/path` seeds a folder for smoke tests.

Not yet: CUE sheets, WebP thumbnails (64/256/600) and dominant-colour extraction (tint is a deterministic hash of the album for now), measured spectral ceiling (shown value is the nominal Nyquist), Songs/Artists/Folders views, macOS security-scoped bookmarks, persisted folder list UI, rate-limited rescans on network drives, automated DB tests (the Electron-ABI binary can't load in vitest; DB behaviour is covered by the Electron smoke test).

## Songs view

The Songs tab (Library → Songs) is a virtualized table: 48px rows, windowed 200-row SQL pages
(`library songs` op) so a 100k-song library scrolls without loading it all.

- Sort by Title / Artist / Album / Time / Quality (`aria-sort`); sorting resets selection.
- Selection: click, Shift-click range, Ctrl/Cmd-click toggle, ↑/↓ (+Shift), Ctrl/Cmd-A. Pure logic in `src/shared/selection.ts` (tested).
- Enter or double-click plays from the row (following rows queue behind it); offline rows are dimmed and not playable.
- Duplicates (same title/artist/duration) are flagged. Column widths are resizable and persist.
- The search box filters Songs and Albums with the same FTS query.

Testing with a real file: symlink it into a folder and launch with
`FLACON_LOG_STATE=1 FLACON_LIBRARY_FOLDER=/tmp/flacon-real npx electron out/main/index.js`.

## M4 — Island

All island states are driven by one pure reducer (`src/shared/islandMachine.ts`, tested): `dot` (nothing loaded),
`compact`, `hover` (150 ms intent; prev/play/next), `expanded` (scrubber; collapses 500 ms after the pointer leaves),
`activity` (new track, 2.5 s) and `error` (engine toast/error, 5 s, `aria-live=assertive`). Activities never interrupt an
expanded island. The pill tint is derived per track and contrast-guarded. Placement (`islandPlacement.ts`) centres on the
display under the cursor, straddles the notch on notched Macs, sits above the taskbar when docked bottom on Windows, and is
re-applied on display changes (tested). Vitest now has a `vitest.config.ts` with the `@shared` alias.
