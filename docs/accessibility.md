# Accessibility

## What is verified automatically
`e2e/a11y.e2e.ts` runs axe-core (WCAG 2.0/2.1 A + AA rules) against the **real Electron app**: welcome dialog, Settings, Albums, Songs, Artists, Folders, Fetch, EQ panel, in light and dark, plus the island window. It currently reports zero violations, and it found and fixed these on the way:
- album cards: accessible name did not contain the visible text (WCAG 2.5.3) → name is now the visible text plus a screen-reader-only hint;
- Songs: `role=table` with `aria-multiselectable` and wrapper divs → proper `grid` / `rowgroup` / `gridcell` structure;
- EQ: frequency labels fell below 4.5:1 when the EQ was off (whole group at 50 % opacity) → only the sliders are dimmed.
`src/renderer/src/styles/tokens.test.ts` additionally audits every text/background token pair for 4.5:1.

## What is NOT verified
Automated rules catch roughly a third of real-world issues. **No human has used Flacon with VoiceOver or NVDA yet** — a screen reader was never run here (it cannot be driven headlessly, and Windows was never available). Treat the script below as a required pre-release step.

### VoiceOver (macOS) — ⌘F5 to toggle
1. Launch; VO should land in the welcome dialog and read its title; Esc closes it and focus returns to the app.
2. VO+Right through the rail: Library, Fetch, Settings read as buttons; the current page is announced.
3. Albums: each card reads title, artist, quality, and the "Press Enter to play" hint; Enter plays; the transport state change is announced.
4. Songs: VO+Cmd+Right into the grid; row/column counts announced; Up/Down moves; Enter plays; column headers are buttons announcing sort direction.
5. Artists/Folders: lists of buttons; opening an item moves focus sensibly and "← All artists / Up" is reachable.
6. EQ: each slider reads "62 Hz" with its dB value (aria-valuetext); preset select labelled.
7. Fetch: search field labelled; results and job rows read with status; failed jobs are announced (role=alert).
8. Space plays/pauses when nothing else is focused; ⌘K focuses search.

### NVDA (Windows) — Ctrl+Alt+N
Repeat 1–8 with Insert+Space (focus mode) toggling for the Songs grid and sliders. Also check high-contrast mode (Alt+Left Shift+PrtSc): focus rings and the quality "fill line" must stay visible.

Record results in this file with the app version, OS, screen-reader version and the failing step numbers.
