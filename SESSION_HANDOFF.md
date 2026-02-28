# Session Handoff (2026-02-28)

This document is a restart guide for future sessions.
It covers both products in this workspace:

1. VS Code extension (`ai-usage-statusbar`)
2. Electron tray app (`tray-app`)

---

## 1) Workspace Layout

- Extension project root: `c:\Users\User\.claude\vscode-ai-usage`
- Tray app: `c:\Users\User\.claude\vscode-ai-usage\tray-app`
- Cat sprite source folder (original generation set): `c:\Users\User\.claude\vscode-ai-usage\src\cat`
- Cat sprite runtime assets (used by tray app): `c:\Users\User\.claude\vscode-ai-usage\tray-app\assets\cat`

---

## 2) VS Code Extension Status

### Identity

- Name: `AI Usage Monitor`
- Package name: `ai-usage-statusbar`
- Publisher: `PayolaJoker`
- Version: `0.2.7`

### Current Behavior

- Single status bar item with emoji markers.
- Example display:
  - `[Claude] C 72% 1h 30m  |  [Codex] O 85% 45m`
- Tooltip shows 5h and 7d usage/reset details.
- Refresh interval: 60 seconds.

### Data Sources

- Claude:
  - `~/.claude/.credentials.json`
  - `GET https://api.anthropic.com/api/oauth/usage`
- Codex:
  - Primary: `codex app-server` with `account/rateLimits/read`
  - Fallback: parse `~/.codex/sessions/*.jsonl`

### Key Files

- `src/extension.ts`
- `out/extension.js`
- `package.json`
- `README.md`
- `tools/codex-rate-limit-check-server.mjs`

### Build / Package

- Compile:
  - `npm run compile`
- VSIX:
  - `npx vsce package`

### Latest Artifact

- `c:\Users\User\.claude\vscode-ai-usage\ai-usage-statusbar-0.2.7.vsix`

### Notes

- Status bar cannot color individual text segments independently in one item.
- Emoji markers are used to preserve visual separation by provider.

---

## 3) Tray App Status

### Identity

- Name: `AI Usage Tray`
- Package name: `ai-usage-tray`
- Version: `0.1.0`
- Platform target: Windows (portable EXE + APPX)

### Current UX

- Always-on mini HUD near Windows taskbar clock area.
- Title text: `AI USAGE`
- Main rows show values as:
  - `<used_percent>% <reset_time>`
  - Example: `34% 3h 55m`
- Top progress rows:
  - `C` / `O` leading badges removed.
- Details toggle button:
  - `+` to open, `-` to close.
  - No explicit `DETAIL` text.
- Details panel layout (compact lines):
  - `5H USED / RESET`
  - `7D USED / RESET`
- Provider color identity preserved:
  - Claude: orange accent
  - Codex: blue accent
- Idle motion:
  - Only cat panel bobs.
  - Entire UI panel does not bob.

### Cat Assets

- Generated cat images were not transparent originally.
- Runtime sprite set in `tray-app/assets/cat` was converted to transparent background.
- Verified by alpha sampling (`alpha(0,0)=0` on converted sprite).

### Data + Logic

- Claude usage:
  - OAuth usage endpoint (same source as extension)
- Codex usage:
  - `codex app-server` primary + session fallback
- Thresholds:
  - Warning: 70%
  - Danger: 85%
- State model:
  - `CALM`, `WATCH`, `HIGH`, `ERROR`, `STALE`
- Details visibility state:
  - Synced between renderer toggle and Electron main process.

### Key Files

- `tray-app/main.js`
- `tray-app/mini.html`
- `tray-app/package.json`
- `tray-app/README.md`

### Important Window Constants

In `tray-app/main.js`:

- `MINI_WIDTH = 560`
- `MINI_HEIGHT = 228`
- `MINI_HEIGHT_DETAILS = 560`

If details content is clipped on a specific display/scaling setup, adjust
`MINI_HEIGHT_DETAILS`.

### Build / Run

- Run:
  - `cd tray-app`
  - `npm install`
  - `npm run start`
- Build EXE:
  - `npm run package:win`
- Build APPX:
  - `npm run package:store`

### Latest Artifacts

- `c:\Users\User\.claude\vscode-ai-usage\tray-app\dist\AI Usage Tray 0.1.0.exe`
- `c:\Users\User\.claude\vscode-ai-usage\tray-app\dist\AI Usage Tray 0.1.0.appx`

---

## 4) Marketplace / Publish Notes

- Extension publish by PAT had an auth error previously:
  - `TF400813` unauthorized
- Manual VSIX upload path was used instead.
- If PAT publish is retried later:
  - Validate Azure DevOps PAT scope for VS Marketplace publish.

---

## 5) Next Session Quick Start

1. Read this file first.
2. For extension work, open `src/extension.ts`.
3. For tray UI work, open `tray-app/mini.html` and `tray-app/main.js`.
4. Run `npm run start` inside `tray-app` for visual verification.
5. Repackage with `npm run package:win` when shipping changes.
