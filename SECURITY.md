# Security policy

Flacon is a local music player. It never uploads your library or listening history. The only network traffic is what you
start (Fetch, optional lyrics lookup, update checks).

- The review behind each release, with proofs: [docs/security-review.md](docs/security-review.md)
- To report a vulnerability, use **Report a problem…** in Settings to produce a redacted report, or contact the maintainers privately; please do not open a public issue for exploitable bugs.
- Runtime: Flacon 0.4.0 ships on Electron 45 (a supported major; Electron 33 was end-of-life, finding F7, now resolved). Fixes for Chromium/Electron issues are picked up by moving to the current supported Electron major.
