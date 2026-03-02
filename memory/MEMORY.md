# AI Usage Monitor - Project Memory

## Project Overview
- VS Code Extension (`0.2.7`) + Windows Tray App (`0.3.6`)
- Repo: https://github.com/payolajoker/vsix-ai-usage-monitor.git
- Claude/Codex API usage monitoring + tray-side gamification layer

## Key Files
- `src/extension.ts` - VS Code extension main logic
- `tray-app/main.js` - Electron tray app main process
- `tray-app/mini.html` - Tray widget UI
- `tray-app/game-config.js` - Game constants/definitions
- `tray-app/game-engine.js` - Progression/event engine
- `tray-app/game-store.js` - Persistent game data store
- `memory/tray-app-issues.md` - Tray issue and QA log

## Current Status (2026-03-02)
- Legacy tray unresolved issue batch (10 items) closed
- Dependency upgrade track completed (`electron-builder` `26.8.1`, `electron` `35.7.5`)
- UI stabilization track completed (toggle sync, repaint, spacing, notification identity)
- Gamification system integrated into tray runtime:
  - XP/level/rebirth
  - 35 achievements + badge assets
  - Daily/weekly missions
  - Sound toggle + SFX
- `game-store.js` syntax/regression issue fixed and validated by `node --check`
- Working tree cleaned and normalized (invalid `nul` entry removed)

## Completed Work Log
- 2026-03-01: Tray app stability/UI issue batch closed (existing 10 issues + QA evidence)
- 2026-03-01: Security/build track closed (`npm audit` clean, build artifacts produced)
- 2026-03-02: Tray gamification integration committed (`feat(tray-app)` commit)
- 2026-03-02: Memory/doc + QA evidence updates committed (`docs(memory)` commit)
- 2026-03-02: Post-merge fix applied to `game-store.js` (object closure/comment-capture bug)

## Verification Snapshot
- Root: `npm run compile` passes
- Tray syntax: `node --check main.js`, `node --check game-*.js` pass
- Tray artifacts present:
  - `tray-app/dist/AI Usage Tray 0.3.6.exe`
  - `tray-app/dist/ai-usage-tray-0.3.6-x64.nsis.7z`
  - `tray-app/dist/AI Usage Tray 0.3.6.appx`

## Reference
- Detailed item-by-item change + QA trace: `memory/tray-app-issues.md`
