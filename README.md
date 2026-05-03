# AI Usage Monitor

Monitor your **Claude** (Anthropic), **Codex** (OpenAI), and **Copilot** usage
directly from VS Code, and optionally through the companion Windows tray app.

## Workspace Components

- VS Code Extension: `ai-usage-statusbar` (`0.2.7`)
- Windows Tray App: `ai-usage-tray` (`0.3.6`)  
  Details: `tray-app/README.md`
- Spec/Roadmap draft: `SPEC_PLAN.md`
- Provider adapters are split per app runtime:
  - Extension: `src/provider-adapter.ts`
  - Tray: `tray-app/provider-adapter.js`
  - Shared contract intent: `getClaudeUsage()` / `getCodexUsage()` /
    `getCopilotUsage()`, but implementation remains app-local.

## Extension Features

- Single status bar indicator with Claude/Codex/Copilot usage summary
- Color-coded warning states (normal/yellow/red)
- Tooltip breakdown for 5-hour and 7-day windows
- 60-second auto-refresh
- Codex source: `codex app-server` (`account/rateLimits/read`) with local
  fallback
- Copilot source: local VS Code `workspaceStorage` (`chatSessions` and
  `GitHub.copilot-chat/transcripts`) with estimated credit usage

### Provider and Color Configuration

Provider enable/disable and status bar color behavior are configured via the
extension settings (`aiUsageMonitor.*`).

This extension uses settings as the single source of truth for behavior.

- `aiUsageMonitor.enabledProviders`
  - Type: `string[]`
  - Allowed values: `claude`, `codex`, `copilot`
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
  - Keys: `claude`, `codex`, `copilot`
  - Customize provider marker symbols
- `aiUsageMonitor.copilotLookbackDays`
  - Type: `number` (1-365)
  - Lookback window used when parsing Copilot local logs
- `aiUsageMonitor.copilotIncludedCredits`
  - Type: `number` (>0)
  - Included credits denominator used for Copilot percentage display
  - `3900` is a practical starting value for Copilot Pro+
- `aiUsageMonitor.copilotAutoModel`
  - Type: `string`
  - Model used to price Copilot records logged as `auto`
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
  "aiUsageMonitor.enabledProviders": ["codex", "copilot"],
  "aiUsageMonitor.enableThresholdColors": true,
  "aiUsageMonitor.showProviderLetter": false,
  "aiUsageMonitor.providerMarkers": {
    "claude": "C",
    "codex": "O",
    "copilot": "G"
  },
  "aiUsageMonitor.copilotLookbackDays": 30,
  "aiUsageMonitor.copilotIncludedCredits": 1000,
  "aiUsageMonitor.copilotAutoModel": "gpt-5.3-codex",
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
| Copilot     | Local VS Code Copilot chat history  |

Configured tools must be installed and used at least once for usage data to
appear.

## Copilot Notes (May 2026)

Copilot monitoring is implemented from local VS Code chat data.

- Input tokens are estimated from locally stored request context.
- Output/cache tokens are exact only when transcript `session.shutdown`
  `modelMetrics` are available.
- Some historical Copilot Chat versions under-recorded `completionTokens`; if
  many records show zero output tokens, limit the lookback window.
- Credit usage is an estimate derived from local pricing tables and may not
  match billing exports exactly.
- The status bar shows estimated USD spend (e.g. `$20.2`) and token volume (e.g.
  `1.4M tok`) alongside the credit-usage percentage.
- Hover tooltip shows compact metrics: request count, token totals, estimated
  spend, credit usage, and a per-model breakdown with rate and spend in USD per
  1M tokens.
- Copilot UI "Included premium requests" is a different quota surface than
  token-credit estimation, so percentages will not match 1:1.

## Status Bar Example

```
🟠 C 72% 1h 30m 🔵 O 85% 45m 🟢G 18% $20.2 1.4M tok
```

Copilot segments show **percent of included credits used**, **estimated USD
spend**, and **total token volume** for the configured lookback window.

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
