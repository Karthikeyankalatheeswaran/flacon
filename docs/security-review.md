# Security review: Flacon 0.4.0

Method: adapted from the [Shannon](https://github.com/KeygraphHQ/shannon) pentest workflow, for a desktop app instead of a web app.
Shannon maps the attack surface first, hunts injection / XSS / SSRF / authorization / path-traversal classes separately,
and reports **only what it can prove**. Here, "prove" means an automated test that fails before the fix and passes after.
Nothing below was run against anyone else's systems; every probe targets this repository, local fixtures or local ffmpeg.

## 1. Trust boundaries and entry points

| Boundary | What crosses it | Untrusted? |
|---|---|---|
| Renderer pages → main (IPC) | ~45 channels (`src/shared/channels.ts`) | Treated as untrusted: every payload is zod-validated and every sender is checked |
| Files on disk → library worker / ffmpeg | audio files, tags, CUE, `.lrc`, artwork | **Yes**: any file the user adds, or a download |
| Network → main | Internet Archive, Wikimedia Commons, ccMixter, Jamendo, LRCLIB, "Paste link", update feed | **Yes**: JSON, redirects, file names, archives |
| OS → main | file-open events, second launch args, power events | Paths are re-validated |
| Main ↔ utility processes | decoder, library worker (own processes, no Node in renderers) | Same-app |

Windows: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; navigation and `window.open` are denied
(`lockDown`); all permission requests are denied; strict CSP (`connect-src 'self'`, so the renderer cannot reach the network at all).

## 2. Findings

| # | Class | Severity | Finding | Proof | Status |
|---|---|---|---|---|---|
| F1 | Injection / SSRF / local file read (ffmpeg) | High | ffmpeg chooses its demuxer by sniffing *content* and understands URLs. A file named `x.flac` that is really an HLS playlist or concat script, or a path like `http://host/x.flac`, could make it read other files or open network connections. Inputs were checked by extension only. | `src/main/ffmpegSafe.test.ts` (real ffmpeg: disguised HLS and concat are refused; URL refused; real FLAC/WAV/AIFF/Ogg/MP3/M4A/MKA/Opus still decode) | **Fixed**: every ffmpeg input now goes through `inputArgs()`: `-protocol_whitelist file,pipe`, a music-container `-format_whitelist`, absolute local paths only |
| F2 | SSRF guard bypass | High | `https://LOCALHOST./`, `https://[::ffff:127.0.0.1]/` (IPv4-mapped IPv6), `*.lan`, and bare names like `https://intranet/` passed `checkFetchUrl`. The code comment also claimed a connect-time DNS check that did not exist. | `src/shared/ssrf.security.test.ts` (33 spellings; 5 failed before) | **Fixed**: trailing dots, full IPv6 parsing (mapped, compatible, NAT64, 6to4, ULA, link/site-local, multicast), single-label and internal suffixes, extra IPv4 blocks; hostnames are now resolved before connecting and refused if any answer is private (`netFetch.ts`) |
| F3 | IPC authorization | Medium | No handler checked who sent the message. Today only our own pages exist, but a page navigated or framed somewhere unexpected could have driven playback, settings, file operations. | `src/main/security.test.ts` (`isTrustedUrl`) | **Fixed**: all handlers go through `handle()` / `on()` which require the main frame of one of our own pages |
| F4 | Dependency: `music-metadata` → `file-type` | Moderate | DoS on malformed ASF files and ZIP-based containers while scanning an untrusted library (advisories GHSA-5v7r-6r5c-r473, GHSA-j47w-4g3g-c36v). | `npm audit --omit=dev` | **Fixed**: music-metadata 11.16.1 (published 2026-09-24, older than the 7-day rule) |
| F5 | Dependency: `zod` 3 | High (advisory) | Memory exhaustion validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5) on IPC payloads. | `npm audit --omit=dev` | **Fixed**: zod 4.6.7 (2026-10-12); typecheck and all tests pass unchanged |
| F6 | Hardening | Low | Electron fuses were at their defaults (`RunAsNode`, `NODE_OPTIONS`, `--inspect` enabled; app code loadable from a folder). | `build/afterPack.cjs` | **Fixed** for packaged builds: those fuses are off and the app loads only from `app.asar` |
| F7 | Dependency: Electron 33 (now 45) | High (advisories) | Electron 33 is end-of-life. The advisories (ASAR integrity bypass, service-worker IPC spoofing, several use-after-free, `moveToApplicationsFolder` / `setAsDefaultProtocolClient` injection, …) are fixed only in newer majors. Flacon does not call the affected APIs (no service workers, no offscreen windows, no protocol client, no remote content), but memory-safety bugs in Chromium are not something to wait on. | `npm audit` | **Fixed**: upgraded to Electron 45.2.2 (Chromium/Node current, supported) with `better-sqlite3` 13.0.3 (N-API prebuilds, no per-ABI rebuild). `npm audit` reports no Electron advisories; remaining findings are dev-only tooling (vite/vitest). Re-tested: typecheck, 307 unit tests, 44 e2e, packaged mac-arm64 launch with fuses applied. Windows build/launch not run here |
| F8 | Dependency: Vitest / Vite (dev only) | Moderate | Dev-server advisories. Not shipped; the test runner never listens on a network port. | `npm audit` | Accepted (dev only) |

### Probed and found sound (with evidence)

- **SQL injection.** All statements are prepared. The only interpolated pieces are a whitelisted sort column (`SORT_SQL[key]`),
  a normalised `asc|desc`, and a scope regex. `src/shared/ipc.security.test.ts` shows hostile sort keys, directions and scopes are rejected at the IPC boundary.
- **Renderer cannot reach library-mutating operations** (`addFolder`, `removeFolder`, `scan`, `recordPlay`, `playlistImport`, …): they are not in `RendererLibraryRequestSchema` (test).
- **Path traversal on downloads and archives.** `sanitizeSegment` and `checkZipEntry` reject `..`, absolute and drive paths, NULs and reserved names (test); archives are also bounded by entry count, size and compression ratio.
- **Artwork protocol** serves only `[a-f0-9]{40}.(jpg|png|webp|gif)` from the art cache.
- **XSS.** The only `dangerouslySetInnerHTML` renders bundled icon SVG constants. Tags, lyrics, file names and titles are rendered as text.
- **Open redirect / external opens.** `openExternalSafe` allows `https:` and `mailto:` only.
- **Duplicate finder cannot delete arbitrary files.** Main re-derives the duplicate groups itself, only allows files inside a group, always spares one copy per group, asks for native confirmation and uses the OS Trash (`safeToTrash` tests; E2E proves `/etc/hosts` and a stray file are refused).
- **Lyrics lookup** sends only artist, title, album and length to `lrclib.net` after opt-in, uses a generic User-Agent, caps the response at 512 KB, validates the JSON with zod, only serves songs that are in the library, and builds the URL so tags can never change the host (test).
- **Report a problem** is local only. The report is redacted (home folder, user name, e-mails, tokens, URL queries, folders of music files) and is shown in full before the user copies or saves it.
- **Secrets.** No credentials in the repository; the Jamendo client ID is user-entered and never written to reports.

## 3. Residual risks (accepted, stated plainly)

- DNS rebinding between the pre-connection lookup and the connection is a race that string checks cannot close. Mitigated by https-only, host choice by providers, and no renderer network access.
- The user can add any folder to the library (it is their computer). A compromised renderer could add `/`; F3 makes that require a compromised *Flacon page*, not just any web content.
- Builds are unsigned. macOS users must approve the first launch; Windows will show SmartScreen. Signing and notarisation need the user's certificates.
- Windows builds are produced but have never been run.
- Chromium / Electron memory-safety bugs remain possible in any release; stay on a supported Electron major (F7: on 45 as of this release; the support window is roughly 8 months per major).

## 4. Re-running the evidence

```bash
npm audit --omit=dev                      # production dependencies
npx vitest run                            # includes the *.security.test.ts and ffmpegSafe tests
npm run test:e2e                          # real app: IPC refusals, duplicate-trash refusal, report redaction
```
