# Tetris — mobile web app

A mobile-first Tetris game built as an installable Progressive Web App. No
frameworks, no build step — plain HTML, CSS, and JavaScript rendered on
`<canvas>`.

## Play it

Serve the folder with any static file server and open it on your phone (or in
a desktop browser):

```bash
npx serve .          # or: python3 -m http.server 8080
```

On a phone, use the browser's **Add to Home Screen** to install it as a
standalone app — the service worker caches everything, so it works offline.

## Controls

**Touch (gestures on the board)**

| Gesture | Action |
| --- | --- |
| Drag left/right | Move piece (one column per cell dragged) |
| Drag down | Soft drop |
| Fast flick down | Hard drop |
| Tap (right ⅔ of board) | Rotate clockwise |
| Tap (left ⅓ of board) | Rotate counter-clockwise |

There's also an on-screen button pad (move, rotate both ways, soft drop, hard
drop, hold) with press-and-hold auto-repeat for movement.

**Keyboard (desktop)**

| Key | Action |
| --- | --- |
| ← / → | Move |
| ↓ | Soft drop |
| ↑ or X | Rotate clockwise |
| Z | Rotate counter-clockwise |
| Space | Hard drop |
| C | Hold |
| P or Esc | Pause |

## Game rules

- **SRS rotation** with full wall-kick tables (separate table for the I piece)
- **7-bag randomizer** with a 4-piece next preview
- **Hold** (once per piece), **ghost piece**, **lock delay** (500 ms, max 15 resets)
- **Guideline scoring**: 100/300/500/800 × level, back-to-back Tetris ×1.5,
  combo bonuses, +1/cell soft drop, +2/cell hard drop
- **Level up** every 10 lines with a guideline gravity curve
- High score persisted in `localStorage`; auto-pause when the app is backgrounded

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell: HUD, board canvas, previews, control pad |
| `styles.css` | Mobile-first layout (safe-area aware, `100dvh`) |
| `tetris.js` | Game engine, rendering, input (touch / keyboard / pad) |
| `manifest.webmanifest` + `sw.js` | PWA install + offline support |
| `icons/` | App icons (SVG + generated PNGs) |
