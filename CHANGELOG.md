# Changelog

All notable changes to this workspace are documented here.

## 2026-03-02

### Tray App (`ai-usage-tray`)

- Finalized gamification integration (`0.3.6`):
  - Added `game-config.js`, `game-engine.js`, `game-store.js`
  - Integrated XP/level/rebirth, achievements, quests, and sound settings
  - Wired renderer/main IPC for game interactions (`game-pet-click`, `game-set-skin`, `game-set-sound`, etc.)
- Added/updated runtime assets:
  - 35 badge images (`tray-app/assets/badges`)
  - cat skin animation set (`tray-app/assets/cat`)
  - sound assets (`tray-app/assets/sounds`)
- Fixed critical post-merge syntax/runtime issue in `game-store.js`.
- Produced/confirmed `0.3.6` build artifacts:
  - `tray-app/dist/AI Usage Tray 0.3.6.exe`
  - `tray-app/dist/ai-usage-tray-0.3.6-x64.nsis.7z`
  - `tray-app/dist/AI Usage Tray 0.3.6.appx`

### Documentation

- Updated handoff and memory docs to reflect actual tray `0.3.6` state.
- Added Playwright UI QA evidence files under `output/playwright/`.

## 2026-03-01

### Tray App (`ai-usage-tray`)

- Stabilization and UI issue batch completed (legacy unresolved 10 items).
- Upgraded dependencies:
  - `electron` -> `35.7.5`
  - `electron-builder` -> `26.8.1`
- Applied detail-toggle sync/repaint and layout/spacing fixes.
- Unified notification identity/title as `AI USAGE`.

### VS Code Extension (`ai-usage-statusbar`)

- Extension release remained at `0.2.7`.
- Maintained app-server-first Codex usage fetch flow and status bar UX refinements.
