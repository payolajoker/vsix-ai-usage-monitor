# AI Usage Tray (Electron)

Windows tray app for Claude + Codex usage monitoring.

## Features

- Tray icon app with no main window
- Always-on mini pet widget near the clock (default on)
- Compact mode + expandable drawer panel
- Pixel-style HUD + block gauges for Claude/Codex
- State-driven cat animation: `CALM`, `WATCH`, `HIGH`, `ERROR`, `STALE`
- Skin system using local cat assets (`assets/cat`) with:
  - Auto skin mode (state/provider-based)
  - Manual lock mode with previous/next skin controls
  - Local persistence (renderer localStorage)
- Expandable panel for 5h/7d usage and reset timers
- Tooltip summary for Claude/Codex 5-hour usage
- Context menu with 5-hour and 7-day details
- Tray menu toggle: show/hide mini window, reposition mini window, focus mode
- 60-second auto refresh
- Windows toast notifications at 70% and 85% thresholds
- Codex source: `codex app-server` first, `~/.codex/sessions` fallback

## Run

```bash
cd tray-app
npm install
npm run start
```

## Build EXE (Portable)

```bash
cd tray-app
npm install
npm run package:win
```

Output is generated under `tray-app/dist/`.

## Microsoft Store Path

`npm run package:store` produces an AppX target.  
To publish to Store, you still need Partner Center setup and package signing / identity alignment.
