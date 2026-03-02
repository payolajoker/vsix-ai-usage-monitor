# AI Usage Tray (Electron)

Windows tray companion app for monitoring Claude + Codex usage with a mini HUD and game-style progression.

## Current Version

- Package: `0.3.6`
- Electron: `35.7.5`
- electron-builder: `26.8.1`

## Features

- Always-on mini widget near the Windows taskbar clock
- Compact/expanded layout with main-process-authoritative detail toggle (`mini-toggle-details`)
- Usage states: `CALM`, `WATCH`, `HIGH`, `ERROR`, `STALE`
- Manual skin switching only (detail view `<` / `>` controls)
- Game system integrated into refresh cycle:
  - XP + level progression (cap 50)
  - Rebirth flow
  - 35 achievements with badge assets
  - Daily/weekly quests
  - Persistent game state (`gamedata.json` in Electron `userData`)
- Tabs in expanded view: `STAT`, `QUEST`, `BADGE`
- Achievement toast UI + optional sound effects (`SOUND` toggle)
- 70% / 85% usage notifications (AppUserModelId + title: `AI USAGE`)
- Data source:
  - Claude OAuth usage API
  - Codex `app-server` primary + session fallback
- 60-second auto refresh

## Key Files

- `main.js` - Electron main process, window/tray lifecycle, IPC, refresh pipeline
- `mini.html` - Mini widget UI/UX and renderer-side game interactions
- `game-config.js` - XP curves, achievements, mission definitions, unlock tables
- `game-engine.js` - Game logic (refresh processing, interaction handling, progression)
- `game-store.js` - Persistent game data store and rollover/archive logic

## Run

```bash
cd tray-app
npm install
npm run start
```

## Build

Build portable EXE:

```bash
cd tray-app
npm install
npm run package:win
```

Build APPX:

```bash
cd tray-app
npm run package:store
```

Outputs are written to `tray-app/dist/`.
