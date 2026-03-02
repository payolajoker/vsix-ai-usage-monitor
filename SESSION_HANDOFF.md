# Session Handoff (2026-03-02)

This document is a restart guide for future sessions.
It covers both products in this workspace:

1. VS Code extension (`ai-usage-statusbar`)
2. Electron tray app (`tray-app`)

---

## 1) Workspace Layout

- Extension project root: `c:\Users\User\.claude\vscode-ai-usage`
- Tray app: `c:\Users\User\.claude\vscode-ai-usage\tray-app`
- Runtime cat assets: `c:\Users\User\.claude\vscode-ai-usage\tray-app\assets\cat`
- QA screenshots: `c:\Users\User\.claude\vscode-ai-usage\output\playwright`

---

## 2) VS Code Extension Status

### Identity

- Name: `AI Usage Monitor`
- Package name: `ai-usage-statusbar`
- Publisher: `PayolaJoker`
- Version: `0.2.7`

### Current Behavior

- Status bar usage indicator for Claude/Codex with tooltip details
- Refresh interval: 60 seconds
- Data sources:
  - Claude OAuth usage API
  - Codex `app-server` (`account/rateLimits/read`) with local session fallback

### Key Files

- `src/extension.ts`
- `out/extension.js`
- `package.json`
- `README.md`
- `tools/codex-rate-limit-check-server.mjs`

### Build / Package

- Compile: `npm run compile`
- VSIX: `npx vsce package`

### Latest Extension Artifact

- `c:\Users\User\.claude\vscode-ai-usage\ai-usage-statusbar-0.2.7.vsix`

---

## 3) Tray App Status

### Identity

- Name: `AI Usage Tray`
- Package name: `ai-usage-tray`
- Version: `0.3.6`
- Platform target: Windows (portable EXE + APPX)

### Current UX / Behavior

- Always-on mini HUD near taskbar clock area
- Details toggle is synchronized by main process (`mini-toggle-details` invoke/handle)
- State model: `CALM`, `WATCH`, `HIGH`, `ERROR`, `STALE`
- Manual-only skin flow (no auto/manual mode toggle)
- Expanded view tabs: `STAT`, `QUEST`, `BADGE`
- Achievement toast UI + sound toggle (`SOUND`)
- Notification identity/title unified to `AI USAGE`

### Game System (Integrated)

- Game modules:
  - `tray-app/game-config.js`
  - `tray-app/game-engine.js`
  - `tray-app/game-store.js`
- Features:
  - XP/level progression + rebirth
  - 35 achievements (badge assets in `tray-app/assets/badges`)
  - Daily/weekly quest tracking
  - Persistent game state in `gamedata.json` (`app.getPath('userData')`)

### Important Window Constants

In `tray-app/main.js`:

- `MINI_WIDTH = 560`
- `MINI_HEIGHT = 238`
- `MINI_HEIGHT_DETAILS = 500`

### Key Files

- `tray-app/main.js`
- `tray-app/mini.html`
- `tray-app/game-config.js`
- `tray-app/game-engine.js`
- `tray-app/game-store.js`
- `tray-app/package.json`
- `tray-app/README.md`

### Build / Run

- Run:
  - `cd tray-app`
  - `npm install`
  - `npm run start`
- Build EXE:
  - `npm run package:win`
- Build APPX:
  - `npm run package:store`

### Latest Tray Artifacts

- `c:\Users\User\.claude\vscode-ai-usage\tray-app\dist\AI Usage Tray 0.3.6.exe`
- `c:\Users\User\.claude\vscode-ai-usage\tray-app\dist\ai-usage-tray-0.3.6-x64.nsis.7z`
- `c:\Users\User\.claude\vscode-ai-usage\tray-app\dist\AI Usage Tray 0.3.6.appx`

---

## 4) Recent Git Commits (Local)

- `58482b1` docs(memory): record tray QA updates and attach playwright evidence
- `cbb7514` feat(tray-app): add gamification system and integrate into tray UI

---

## 5) Next Session Quick Start

1. Read this file first.
2. For extension work, open `src/extension.ts`.
3. For tray/game work, open `tray-app/main.js`, `tray-app/mini.html`, `tray-app/game-*.js`.
4. Run `npm run start` inside `tray-app` for visual verification.
5. Repackage with `npm run package:win` when shipping tray changes.
