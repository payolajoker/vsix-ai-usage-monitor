# AI Usage Monitor

Monitor your **Claude** (Anthropic) and **Codex** (OpenAI) usage directly from
VS Code, and optionally through the companion Windows tray app.

## Workspace Components

- VS Code Extension: `ai-usage-statusbar` (`0.2.7`)
- Windows Tray App: `ai-usage-tray` (`0.3.6`)  
  Details: `tray-app/README.md`
- Spec/Roadmap draft: `SPEC_PLAN.md`
- Provider adapters are split per app runtime:
  - Extension: `src/provider-adapter.ts`
  - Tray: `tray-app/provider-adapter.js`
  - Shared contract intent: `getClaudeUsage()` / `getCodexUsage()`, but
    implementation remains app-local.

## Extension Features

- Single status bar indicator with Claude/Codex usage summary
- Color-coded warning states (normal/yellow/red)
- Tooltip breakdown for 5-hour and 7-day windows
- 60-second auto-refresh
- Codex source: `codex app-server` (`account/rateLimits/read`) with local
  fallback

### Provider and Color Configuration

Provider enable/disable and status bar color behavior are configured via the
extension settings (`aiUsageMonitor.*`).

This extension uses settings as the single source of truth for behavior.

- `aiUsageMonitor.enabledProviders`
  - Type: `string[]`
  - Allowed values: `claude`, `codex`
  - Example: `["codex"]` to run Codex only
  - Use `[]` to disable all providers
- `aiUsageMonitor.enableThresholdColors`
  - Type: `boolean`
  - `true`: apply warning/critical colors based on thresholds
  - `false`: keep default status bar foreground color when data is available
- `aiUsageMonitor.showProviderLetter`
  - Type: `boolean`
  - `true`: show marker plus provider letter (for example `🔵 O`)
  - `false`: show marker only (for example `🔵`)
- `aiUsageMonitor.providerMarkers`
  - Type: `object`
  - Keys: `claude`, `codex`
  - Customize provider marker symbols
- `aiUsageMonitor.weeklyExhaustedDisplay`
  - Type: `string`
  - Values: `percent`, `remainingDays`
  - Controls status-bar display when weekly cap is exhausted
- `aiUsageMonitor.warningThreshold`
  - Type: `number` (0-100)
  - Warning color threshold
- `aiUsageMonitor.criticalThreshold`
  - Type: `number` (0-100)
  - Critical color threshold
- `aiUsageMonitor.statusBarColors`
  - Type: `object`
  - Keys: `disabled`, `warning`, `critical`
  - Set colors that match your VS Code theme

Example `settings.json`:

```json
{
  "aiUsageMonitor.enabledProviders": ["codex"],
  "aiUsageMonitor.enableThresholdColors": true,
  "aiUsageMonitor.showProviderLetter": false,
  "aiUsageMonitor.providerMarkers": {
    "claude": "C",
    "codex": "O"
  },
  "aiUsageMonitor.weeklyExhaustedDisplay": "remainingDays",
  "aiUsageMonitor.warningThreshold": 70,
  "aiUsageMonitor.criticalThreshold": 90,
  "aiUsageMonitor.statusBarColors": {
    "disabled": "#8b949e",
    "warning": "#e3b341",
    "critical": "#ff7b72"
  }
}
```

## Extension Requirements

| Tool        | Requirement                         |
| ----------- | ----------------------------------- |
| Claude Code | `~/.claude/.credentials.json`       |
| Codex CLI   | `codex` command available in `PATH` |

Configured tools must be installed and used at least once for usage data to
appear.

## Copilot Findings (May 2026)

Copilot monitoring is intentionally not implemented in this extension for now.

- Copilot usage/limits are available in the VS Code Copilot UI.
- A stable, documented local API surface for reading session/weekly/monthly
  Copilot counters was not available for this extension runtime.
- To avoid unreliable telemetry, Copilot support was removed from active
  providers.

## Status Bar Example

```
🟠 C 72% 1h 30m  |  🔵 O 85% 45m
```

## Quick Probe (Before Extension Debugging)

Run:

```bash
npm run probe:codex-web
```

Then open:

```
http://127.0.0.1:47931
```

Use the button to run a one-shot `codex app-server` check and inspect raw JSON.

## Development / Debug Quick Guide

See `DEVELOPMENT_DEBUG.md` for local extension debug profiles, watch-mode
workflow, and warning-noise suppression details.

## Tray Companion (0.3.6) Summary

- Always-on mini HUD near taskbar clock
- `STAT` / `QUEST` / `BADGE` tabs in expanded mode
- XP/level/rebirth + achievements + quests
- Optional SFX and persistent game state

## Quality Checks

- Tray IPC smoke tests:

```bash
npm --prefix tray-app run test:ipc
```

- Tray game unit tests:

```bash
npm --prefix tray-app run test:game
```

- Full release gate (compile + syntax + tests + docs/version sync):

```bash
npm run release:check
```

## License

MIT. See `LICENSE`.
