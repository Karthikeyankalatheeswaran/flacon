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

## M5 — EQ / DSP

10-band graphic EQ (31 Hz–16 kHz, ±12 dB in 0.5 dB steps, shelves at the ends) plus preamp, in the engine window:
`worklet → 10 BiquadFilters → preamp → safety limiter → destination`. Parameters glide over ~20 ms so dragging never clicks.
Preamp auto-compensates the largest boost (shown in the panel); the limiter (−1 dB, 20:1) is only active while the EQ is on.
With the EQ off every stage is at unity, labelled "bit-perfect path" in the UI.

- Model, presets, response maths and zod schema: `src/shared/eq.ts` (tested). The curve in the panel uses the same biquad maths.
- Command `{type:'eq', eq}` is validated in main, applied by the engine and echoed in `PlaybackState.eq` so all windows agree.
- Persisted to `<userData>/eq.json` (debounced; malformed files fall back to flat) and replayed to the engine at launch.
- UI: EQ button in the vessel opens the panel (Esc closes; sliders are native, keyboard-accessible, double-click resets a band).
- Dev note: unpackaged `electron out/main/index.js` uses the `Electron` userData folder, not `flacon`.
- Not yet: parametric bands, crossfeed, ReplayGain, per-device profiles.

## M6 — Fetcher

Fetch page (rail → Fetch): search, queue, controls. Everything downloaded is checked before it reaches the library.

**Providers** (`src/main/fetcher/providers.ts`): Internet Archive (only items with a recognised CC / public-domain licence and FLAC files),
Jamendo (CC, official API, your own client ID in the page), and Paste link (direct https file or ZIP you are entitled to; nothing is bypassed).
No DRM circumvention, no streaming-service ripping. The renderer never supplies a catalogue URL: it names a search hit and main resolves it.

**Safety rules** (`src/shared/fetch.ts`, all unit-tested): https only; no credentials in URLs; loopback/private/link-local targets blocked, re-checked on every redirect hop;
honest `User-Agent`; per-host 1 s spacing; ZIP: zip-slip rejected, only audio/art/cue/log extracted, entry/size/ratio limits measured on bytes actually written;
filenames NFC-normalised, Windows reserved names and trailing dots handled, long names truncated with a hash, case-insensitive collisions resolved.

**Download manager** (`manager.ts`, `download.ts`): 3 concurrent, HTTP Range resume from `.part`, atomic rename, exponential backoff with jitter (5 tries),
permanent errors (403/404) not retried, pause/resume/cancel (cancel deletes partial data), disk-space preflight, queue persisted to `fetch-jobs.json` and recovered on restart.
Network goes through Electron's `net.fetch`, so system proxy settings apply.

**Post-processing** (`verify.ts`, `analysis.ts`, `postprocess.ts`): FLAC decode test + STREAMINFO MD5 comparison; corrupt files are rejected.
Spectral cutoff analysis flags lossless files that stop near 16/19/20 kHz ("likely lossy source"); padded 16-bit-in-24 is flagged. Findings show on the job, the file is still kept.
Missing tags are filled from the source, the licence is written into the file (COPYRIGHT/LICENSE) without re-encoding, files are renamed by
`{albumartist}/{album} ({year})/{disc}-{track} {title}` into `~/Music/Flacon`, and cover art beside the audio is copied as folder art.

**Watch Downloads folder** (opt-in): a new ZIP containing lossless audio is *copied* into the queue; the original stays untouched.

Not yet / known gaps: providers run in the main process (modules never touch the filesystem, but a separate fetcher utilityProcess is still to do);
dedupe is by target path + size, not by tags/duration against the library; artwork is folder art, not embedded; Jamendo client ID is stored in plain JSON in userData
(it's a public identifier, not a secret); only the Internet Archive search was exercised against the live API (read-only), no real download was run.

## M7 — Settings, persistence, onboarding, accessibility

**Settings store** (`src/shared/settings.ts`, `src/main/settingsStore.ts`): one versioned JSON file (`settings.json` in userData) with an explicit migration list,
per-field fallback (one bad value never resets the rest), atomic debounced writes, and corruption recovery (damaged file moved to `settings.json.corrupt-<time>`,
defaults used, and the Settings page says so). A file from a newer build is read for the fields we know and backed up before being touched. Migrations keep a `.v<N>.bak` of the old shape.
This is deliberately a small in-house store, not `electron-store` (ESM-only, doesn't fit this CJS main bundle). EQ (`eq.json`) and fetch settings/queue keep their own files for now.

Persisted: theme, open-at-login, pause-on-sleep, island edge (Windows), volume, onboarded flag, main-window bounds **per display** (restored only if still on a connected screen with a reachable title bar),
and the session (queue, track, position). The session restores **paused** at the saved position; files on an unmounted drive are skipped. Saved every 15 s and at quit.

**Settings page** (rail → Settings): appearance, open at login (registered only in packaged builds; a login launch stays in the tray/island with the window closed),
pause on sleep, island edge (Windows), library folders with confirm-before-remove (removing a folder drops its songs from Flacon and never touches files).
Also fixed: folder path matching used `LIKE root%`, which also matched sibling folders such as `/music2`.

**Onboarding**: one dismissible sheet on first run (Esc skips), shown once.

**Accessibility**: ⌘/Ctrl+K focuses search, Space plays/pauses unless a control wants the key, skip link, arrow/Home/End on tabs, `prefers-reduced-motion` honoured globally (island already did).
A token audit test (`tokens.test.ts`) checks WCAG AA (4.5:1) for text colours on every surface in both themes; it found and fixed two near-misses (light `--ink-2` 0.60→0.64 alpha, `--ok` darkened slightly: a small deliberate deviation from the handoff values).

**Performance**: the Songs table renders ~28 DOM rows whatever the library size (checked with 100,000 mock songs: `?songs=100000` on the web preview). Real frame timings and a 100k-row SQLite benchmark were **not** measured
(the preview pane throttles animation frames; the database needs the Electron ABI), so 60 fps at 100k is a design expectation, not a measured result.

Not yet: screen-reader pass with VoiceOver/NVDA, high-contrast mode, per-device audio profiles, settings for naming template/download location, export/import of settings.

## M8 — Packaging, signing, updates, E2E
- **Packaging:** `electron-builder.yml` (mac dmg+zip, Windows NSIS, file associations, hardened runtime, native modules + ffmpeg unpacked from asar). `npm run package:dir` produced a working macOS arm64 app (~313 MB) that I launched and played a real FLAC in. See [docs/packaging.md](docs/packaging.md).
- **Updates:** pure reducer (`shared/update.ts`, tested) + `electron-updater` wrapper, opt-out in Settings → Updates; inert without a feed.
- **E2E:** `npm run test:e2e` drives the real built app with Playwright-Electron (10 tests: boot, onboarding, indexing, playback, Songs, EQ persistence, theme, search shortcut, link rejection, session restore). Set `E2E_APP` to run against a packaged build. It already caught one real regression (an ESM import of `electron-updater` that crashed boot).
- **CI:** `.github/workflows/ci.yml` — typecheck/unit/E2E on macOS + Windows; tag builds run the ffmpeg gate and package with secrets from the environment.

**Honest gaps:** Windows x64 is wired (MSYS2 ffmpeg script, NSIS, CI job incl. packaged E2E, cross-platform native-rebuild script, a `/`-split path bug fixed) but never executed — I only have a Mac; first CI run will likely surface issues. Windows arm64 and macOS x64 targets are disabled until their ffmpeg builds exist. No real signing or notarization was performed (no credentials). No update feed is configured. ffmpeg is now a bundled LGPL-2.1 + libsoxr build (`scripts/build-ffmpeg.sh`, gate passes, verified in dev and in the packaged app); only macOS arm64 is built — x64 and Windows binaries still need building. The app icon is a flask (the "flacon") filled with a sound-wave surface, my own design (`build/icon.svg` → `build/icon.png` via `scripts/render-icon.cjs`; electron-builder derives .icns/.ico) — worth a designer's eye; the Windows .ico and the tray glyph weren't checked. No VoiceOver/NVDA pass; 100k-song performance unmeasured.

## Post-M8 additions
- **CUE sheets:** a `.cue` beside its audio indexes as one library track per CUE track (virtual path `album#cue02.flac`), plays only its slice (decoder `-ss/-t`, slice-relative position and duration, own title), and the long file is not also listed. Parser tolerates UTF-8/Latin-1, DATA tracks, bad lines; FILE names are honoured by base name only (no `../`).
- **Artists / Folders tabs:** Artists groups by album artist (case/accent-insensitive); Folders browses the library as it sits on disk and plays from the chosen track.
- **Archivo** is bundled (variable woff2 via `@fontsource-variable/archivo`), served under the strict CSP.
- **Engine fix found by the new E2E tests:** a seek/skip whose new stream decoded inside the 10 ms fade-out window had its first audio and track mark discarded by the flush, leaving playback stuck in "loading". The worklet now flushes only audio written before the flush point.

### First real-network fetch (Internet Archive) — what it found
Running the fetcher against archive.org for the first time (`E2E_NET=1 npx vitest run --config vitest.e2e.config.ts e2e/fetch.e2e.ts`, downloads ~4 MB of public-domain FLAC to a temp folder) exposed five bugs the mocked tests could not:
1. Electron's `net.fetch(..., {redirect:'manual'})` cancels instead of returning the 3xx, so every archive.org `/download/` (302 → data node) failed → new `netFetch.ts` with real manual redirects, each hop still SSRF-checked.
2. An extra `'data'` listener (for progress) on the download stream intermittently corrupted the written file (~4 of 5 runs) → progress now reported from an awaited write loop; verified bit-exact 6/6.
3. Archive's old-style `licenses/publicdomain/` URL (no version) wasn't recognised as Public Domain.
4. The minimal LGPL ffmpeg lacked the PCM/FLAC muxers and encoders the verifier/tagger use → added to the build scripts.
5. Dev builds silently fell back to the GPL ffmpeg-static (wrong `vendor/` path) so the above only showed up with the bundled one.

### Accessibility
`npm run test:e2e` now includes an axe-core audit of every screen in light and dark (clean; it found and fixed four real issues). **A real VoiceOver/NVDA pass has still not been done** — see [docs/accessibility.md](docs/accessibility.md) for the exact script.

### Installers & honest status
`scripts/package-all.sh` produces `dist/Flacon-0.1.0-mac-{arm64,x64}.dmg` and `Flacon-0.1.0-win-{x64,arm64}-setup.exe` (+ zips). See [docs/packaging.md](docs/packaging.md). **Never executed: any Windows binary. Not done: code signing / notarization (no Apple Developer ID or Authenticode cert), a real update feed, a human VoiceOver/NVDA pass, update install/relaunch.** Planned features: [docs/roadmap.md](docs/roadmap.md).


## v0.2 — playlists, queue, purity, island rework
- **Purity %** on every song/album/player: a background analyser decodes ~20 s from the middle of each lossless file (bundled ffmpeg), finds where the signal stops and how many bits the samples really use. 96 %+ of the Nyquist range reads 100. Lossy files show "Lossy". Verified on a real 24/44.1 FLAC (100 %, 21.5 kHz ceiling, 24 effective bits). It is a heuristic, not proof of provenance.
- Playlists, queue, favourites, Blends (smart lists), shuffle/repeat, ReplayGain, lyrics, Tonight and Listening pages, context menus, M3U import/export.
- Native menu bar (macOS: Flacon ▸ Settings… ⌘,), Windows gets the same accelerators.
- Flacon Island: real artwork, purity badge, animated bars, heart/shuffle/repeat, scrubber; Settings: show/hide, always vs while playing, size, artwork, badge.
- Icons: Phosphor (MIT, light weight; `docs/PHOSPHOR-LICENSE.txt`). Palette retuned for light and dark with a warm accent.
- Crossfade (Settings ▸ Playback): equal-power overlap on natural track changes; skip and seek never crossfade. Verified in the real app (hand-over 5.1 s after a seek with 6 s on vs 10.3 s off).
- Fetch: audio quality (Best available / Lossless only / Compact MP3) for Internet Archive, Wikimedia Commons and Jamendo; every item needs a recognised free licence. ccMixter was tried and dropped (its server's responses stall Chromium and overflow Node's header limit).
- Not implemented: see `docs/roadmap.md`.
