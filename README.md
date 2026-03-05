# AI Usage Monitor

Monitor your **Claude** (Anthropic) and **Codex** (OpenAI) usage directly from VS Code, and optionally through the companion Windows tray app.

## Workspace Components

- VS Code Extension: `ai-usage-statusbar` (`0.2.7`)
- Windows Tray App: `ai-usage-tray` (`0.3.6`)  
  Details: `tray-app/README.md`
- Spec/Roadmap draft: `SPEC_PLAN.md`
- Provider adapters are split per app runtime:
  - Extension: `src/provider-adapter.ts`
  - Tray: `tray-app/provider-adapter.js`
  - Shared contract intent: `getClaudeUsage()` / `getCodexUsage()`, but implementation remains app-local.

## Extension Features

- Single status bar indicator with Claude/Codex usage summary
- Color-coded warning states (normal/yellow/red)
- Tooltip breakdown for 5-hour and 7-day windows
- 60-second auto-refresh
- Codex source: `codex app-server` (`account/rateLimits/read`) with local fallback

## Extension Requirements

| Tool | Requirement |
|------|-------------|
| Claude Code | `~/.claude/.credentials.json` |
| Codex CLI | `codex` command available in `PATH` |

Both tools must be installed and used at least once for usage data to appear.

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
