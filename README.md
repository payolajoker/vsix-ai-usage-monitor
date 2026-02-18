# AI Usage Monitor

Monitor your **Claude** (Anthropic) and **Codex** (OpenAI) usage directly from the VS Code status bar — no browser required.

## Features

- **Status bar indicators** — Shows remaining usage (%) for both Claude and Codex at a glance
- **Color-coded warnings** — Green → Yellow → Red as usage increases
- **Hover tooltip** — Displays a detailed breakdown: 5-hour session and 7-day weekly limits with reset timers
- **Auto-refresh** — Updates every 60 seconds automatically

## Requirements

| Tool | Required file |
|------|--------------|
| Claude Code | `~/.claude/.credentials.json` |
| Codex CLI | `~/.codex/sessions/` directory |

Both tools must be installed and have been used at least once for their usage data to appear.

## Status Bar

```
● 72%  1h 30m    ● 85%  45m
 Claude              Codex
```

- `●` icon turns **yellow** when remaining usage drops below 30%
- `●` icon turns **red** when remaining usage drops below 15%
- `⚠` icon appears if usage data cannot be retrieved

## Tooltip

Hover over either indicator to see a detailed table:

| | Remaining | Resets In |
|---|---|---|
| 5-Hour Session | **72%** | 1h 30m |
| 7-Day Weekly | **55%** | 3d 12h |

## Notes

- Claude usage is fetched via the Anthropic OAuth API using the local credentials file managed by Claude Code
- Codex usage is read from local session files managed by the Codex CLI
- No data is sent anywhere — everything runs locally
