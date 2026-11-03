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
