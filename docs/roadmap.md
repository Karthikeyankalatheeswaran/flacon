# Flacon roadmap — Spotify / Apple Music–style features

Flacon is a local-first lossless player. This list takes the features people expect from Spotify and Apple Music and sorts them by whether they fit a local library, what they need, and rough size. Streaming-catalogue features are deliberately out of scope (licensing), and are marked.

Size: S ≈ days, M ≈ 1–2 weeks, L ≈ a month+.

## Status (update: v0.2 work)
**Built:** playlists (create/rename/delete, drag-reorder, M3U/M3U8 import + export), play queue (Up Next: add next/last, jump, remove, drag-reorder, clear), favourites and 1–5 ratings (stored), smart lists as "Blends" (Favourites, Recently played, Most played, Recently added, Verified pure, Added this month, To review), play counts and history (a play counts after 30 s or half the track), shuffle and repeat (off/all/one), ReplayGain (track mode, never clips), lyrics (`.lrc` sidecar or embedded, synced highlight), Home ("Tonight") shelves, Listening stats, native app menu with Settings (⌘,) and keyboard shortcuts, redesigned Flacon Island with settings, and **purity**: a measured percentage of each lossless file's frequency range that holds real signal, shown on every song, album and in the player.

**Also built since:** crossfade (0/3/6/10 s, natural track changes only), audio-quality choice on Fetch (best / lossless only / compact MP3), Wikimedia Commons as a free source, island close button, translucent player panel (white in dark, black in light), a water-level island progress bar, drag-and-drop import with an always-visible Add button, folder breadcrumbs, six island spots (top/bottom × left/centre/right; drag to move, right-click or tray for a Position menu, picker in Settings and onboarding), a generated minimalist cover for albums with no artwork, and a ranked Internet Archive search (every word must match; lossless-first; each hit labelled FLAC / 24-bit FLAC / MP3).

**Not built (still on the list):** tag editor, MusicBrainz / cover-art lookup, scrobbling, media keys / Now Playing / SMTC, radio / similar-to-this, daily mixes, output-device picker and exclusive mode, casting, mobile remote, DSD, parametric EQ, star-rating UI (ratings are stored, only hearts are in the UI). Podcasts and internet radio were deliberately left out.

## Tier 1 — core listening
| Feature | Notes | Size |
|---|---|---|
| **Playlists** (create, reorder, drag from Songs/Albums, export/import M3U8) | New `playlists` tables in the library DB (migration v3). Biggest missing basic. | M |
| **Play queue** (Up Next, add next/last, reorder, clear, history) | Engine already has a track list; needs a visible, editable queue UI. | M |
| **Favourites / ratings** (heart, 1–5 stars) | Column + filter; smart playlists build on it. | S |
| **Smart playlists** (rules: genre, year, rating, added, played, quality) | Rule builder compiled to SQL over the existing worker. | M |
| **Play counts & recently played / added** | Row per play; powers Home shelves. | S |
| **Shuffle / repeat modes** (album-aware shuffle, repeat one/all) | Mostly engine + UI state. | S |
| **Gapless + crossfade + ReplayGain / Sound Check** | Gapless exists; add crossfade (worklet mix) and loudness normalisation (read RG tags, else EBU R128 scan in worker). | M |
| **Lyrics** (embedded + `.lrc`, synced highlight) | Parse tags/sidecars; optional LRCLIB lookup (opt-in network). | M |
| **Media keys, Now Playing (macOS) / SMTC (Windows)** | Native OS integration; system-wide controls and lock-screen art. | M |

## Tier 2 — library intelligence
| Feature | Notes | Size |
|---|---|---|
| **Tag editor** (single + batch, art replace, rename-from-tags) | Write FLAC/ID3 tags safely with undo. | L |
| **MusicBrainz / Cover Art Archive lookup** | Fix missing metadata/artwork; opt-in, rate-limited. | M |
| **Duplicate and quality manager** | Duplicates are detected; add review UI and "keep best quality". Upscale detection already exists. | S |
| **Genres, decades, composers, labels browse** | More tabs on the existing grouping code. | S |
| **Stats ("Wrapped"-style year in review)** | Needs play history (Tier 1); local-only charts. | M |
| **Library health** (missing files, bad tags, unreadable) | Surface worker errors. | S |

## Tier 3 — discovery (local, no accounts)
| Feature | Notes | Size |
|---|---|---|
| **Home shelves** (jump back in, recently added, on repeat, forgotten favourites) | Pure queries. | S |
| **Radio / Similar to this** | Similarity from tags + play co-occurrence (+ optional MusicBrainz/ListenBrainz). Not a streaming recommendation engine. | L |
| **Daily mixes** | Auto-generated smart playlists from taste clusters. | M |
| **Scrobbling** (Last.fm, ListenBrainz) | Opt-in; credentials via OS keychain, never in config. | M |
| **Podcasts** (RSS subscribe, episodes, resume position) | Separate library section; reuse the resumable downloader. | L |
| **Internet radio** (Shoutcast/Icecast, radio-browser.info) | Needs a live-stream decoder path. | M |

## Tier 4 — devices & sharing
| Feature | Notes | Size |
|---|---|---|
| **Output device picker + exclusive/bit-perfect mode** (WASAPI exclusive, CoreAudio hog) | Needs native addon; core to "audiophile" positioning. | L |
| **AirPlay / Chromecast / DLNA casting** | Per-protocol libraries; DLNA easiest. | L |
| **Mobile remote** (phone controls the desktop over LAN) | Local web UI + pairing code. | M |
| **Offline sync to phone / DAP** (transcode or copy) | Folder/device sync with format rules. | L |
| **Share / listen together** | Needs a server; defer. | L |
| **Mini player + global hotkeys + menu-bar/tray controls** | Island and tray exist; add hotkeys and compact mode. | S |

## Tier 5 — audio quality
| Feature | Notes | Size |
|---|---|---|
| **DSD (DSF/DFF) playback** (DoP / PCM conversion) | ffmpeg decodes; add formats to the indexer and a DoP path. | M |
| **Parametric EQ + per-device presets + AutoEQ import** | EQ is 10-band graphic today. | M |
| **Spectrogram / quality report per track** | Ceiling is computed; render the full spectrogram. | M |
| **Dolby Atmos / spatial** | Platform-specific; likely out of scope. | — |

## Out of scope (need licensing or a backend)
Catalogue streaming, Spotify Connect, Apple Music subscription catalogue, artist/label royalty features, collaborative playlists across accounts, social feed, and DRM'd downloads. A pragmatic bridge: **import** Spotify/Apple Music playlists (CSV/JSON export) and match them to local files.

## Suggested order
1. Playlists + queue + favourites + play counts (unlocks everything else).
2. Media keys / Now Playing, shuffle/repeat, ReplayGain, crossfade.
3. Lyrics, tag editor, MusicBrainz.
4. Smart playlists, Home shelves, stats.
5. Scrobbling, output-device/exclusive mode, casting, mobile remote.

## Release blockers independent of features
Code signing + notarization (Apple Developer ID, Authenticode cert), a hosted update feed, a first real run on Windows, a human VoiceOver/NVDA pass, and performance measurement on a large (50k+ track) library.
