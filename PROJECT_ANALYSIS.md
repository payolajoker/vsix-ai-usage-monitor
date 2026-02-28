# Project Analysis

> Note: This file is an older baseline snapshot.
> For the latest cross-project status (extension + tray app), read `SESSION_HANDOFF.md`.

## 1) Overview
- Project: `AI Usage Monitor` (`ai-usage-statusbar`)
- Type: VS Code extension
- Goal: Show Claude and Codex usage in the VS Code status bar
- Current version: `0.2.5`

## 2) Stack and Build
- Language: TypeScript
- Runtime: Node.js (VS Code Extension Host)
- Build command: `tsc -p ./`
- Key compiler settings:
  - `module: commonjs`
  - `target: ES2020`
  - `rootDir: src`
  - `outDir: out`
  - `strict: false`

Build verification:
- `npm run compile` completed successfully.

## 3) Source Structure
- Main logic is in one file:
  - `src/extension.ts`
- Entry points:
  - `activate()`: creates status bar items, does initial refresh, starts 60s refresh timer
  - `deactivate()`: clears timer

## 4) Runtime Behavior
### 4-1. Shared rendering flow
- `doRefresh()` fetches Claude and Codex usage in parallel.
- `renderBar()` updates status bar text, color, and tooltip.
- Color thresholds:
  - >= 70%: yellow
  - >= 85%: red

### 4-2. Claude usage flow
- Reads OAuth token from `~/.claude/.credentials.json`
- Calls `GET https://api.anthropic.com/api/oauth/usage`
- Uses `Authorization` and `anthropic-beta` headers
- Maps:
  - `five_hour.utilization`, `five_hour.resets_at`
  - `seven_day.utilization`, `seven_day.resets_at`

### 4-3. Codex usage flow
- Scans `~/.codex/sessions`
- Recursively finds `.jsonl` files and checks newest files first
- Parses up to 5 recent files for `event_msg -> token_count -> rate_limits`
- Maps:
  - `primary.used_percent`, `primary.resets_at`
  - `secondary.used_percent`, `secondary.resets_at`

## 5) Strengths
- Clear user value with fast status visibility in editor UI
- Unified display model for both Claude and Codex
- Safe fallback on failures with warning indicator
- Small, readable codebase that is easy to reason about

## 6) Risks and Gaps
1. Synchronous file I/O
- Heavy usage of `readFileSync`, `readdirSync`, and `statSync` can block extension host under larger data sets.

2. Low type strictness
- `strict: false` and `any` reduce compile-time safety.

3. Fragile Codex parsing assumptions
- Parsing depends on a specific event structure and may break if session log schema changes.

4. No tests
- Missing unit/integration tests increases regression risk.

5. Internal documentation gap
- README is user-focused; maintainers lacked a dedicated analysis baseline.

## 7) Recommended Next Steps
1. Move filesystem reads to `fs.promises` async paths.
2. Enable TypeScript strictness incrementally.
3. Harden Codex parser with schema guards and fallback field handling.
4. Add tests for:
  - `toPercent`
  - `formatReset`
  - usage parsing logic
5. Standardize error messages for user-facing vs debug contexts.

## 8) Maintenance Notes
- This file is the baseline analysis snapshot.
- Future updates should add:
  - VSIX release flow details
  - version-by-version change table
  - simple performance metrics (refresh time, scan time)
