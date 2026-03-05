# Project Analysis (Updated: 2026-03-04)

This snapshot covers the current workspace state.

Planning reference: `SPEC_PLAN.md`

## 1) Overview

- Project: `AI Usage Monitor`
- Products:
  - VS Code extension `ai-usage-statusbar` (`0.2.7`)
  - Electron tray app `ai-usage-tray` (`0.3.6`)
- Goal: realtime Claude/Codex usage visibility in-editor and in a desktop mini HUD

## 2) Stack

- Extension:
  - TypeScript + VS Code Extension Host
  - Build: `npm run compile`
- Tray app:
  - Electron (`35.7.5`)
  - Packaging: electron-builder (`26.8.1`)
  - Main UI: `mini.html` + main process IPC

## 3) Runtime Data Sources

- Claude: OAuth usage API (`~/.claude/.credentials.json` token source)
- Codex:
  - Primary: `codex app-server` (`account/rateLimits/read`)
  - Fallback: local session parsing

## 4) Current Architecture Notes

### Extension

- Core logic in `src/extension.ts`
- Provider/data adapter split into `src/provider-adapter.ts`
- 60-second polling timer
- Status bar + tooltip rendering with threshold coloring

### Tray App

- Main process:
  - window/tray lifecycle
  - refresh orchestration
  - notification/positioning logic
  - game IPC handlers
- Provider/data adapter split into `tray-app/provider-adapter.js`
- Renderer (`mini.html`):
  - compact/expanded HUD
  - tabs: `STAT`, `QUEST`, `BADGE`
  - achievement toast and sound toggle
- Game modules:
  - `game-config.js` (definitions)
  - `game-engine.js` (rules/progression)
  - `game-store.js` (persistent data/rollover)

### Provider Contract (Intent)

- Both apps expose app-local adapter entrypoints with the same interface intent:
  - `getClaudeUsage()`
  - `getCodexUsage()`
- Implementations intentionally remain separate because the runtimes differ (VS Code extension host vs Electron main process).

## 5) Strengths

- End-to-end local monitoring workflow with no external relay
- Dual-surface UX (editor + tray)
- Stabilization fixes applied to tray rendering/toggle path
- Modularized game logic (config/engine/store split)

## 6) Risks / Gaps

1. Tray packaging can take long in automation contexts; command timeout handling needs clear CI policy.
2. Automated quality checks now exist (IPC smoke + game unit + release gate), but renderer-level end-to-end UI automation still needs broader coverage.
3. Extension/tray release/versioning workflow is improved with release gate scripting, but CI integration policy is still open.

## 7) Recommended Next Steps

1. Add CI wiring for `npm run release:check` and Windows packaging validation strategy.
2. Expand renderer-level UI regression tests (state transitions, stale/source rendering, tab interactions).
3. Add support diagnostics payload UX (copy-safe summary without sensitive data).
