# AI Usage Monitor

Monitor your **Claude** (Anthropic) and **Codex** (OpenAI) usage directly from the VS Code status bar.

## Features

- **Single status bar indicator**: Shows Claude + Codex usage in one line with color emoji markers.
- **Color-coded warnings**: Normal to Yellow to Red as usage increases.
- **Hover tooltip**: Displays a detailed breakdown for 5-hour session and 7-day weekly limits with reset timers.
- **Auto-refresh**: Updates every 60 seconds automatically.

## What's New (0.2.7)

- Switched status bar text to color-emoji format (`🟠 Claude`, `🔵 Codex`) in a single item.
- Updated details and requirements around Codex app-server based fetching.
- Added local probe page to test Codex rate-limit fetch before extension debugging.

## Requirements

| Tool | Requirement |
|------|-------------|
| Claude Code | `~/.claude/.credentials.json` |
| Codex CLI | `codex` command available in `PATH` (app-server) |

Both tools must be installed and have been used at least once for usage data to appear.

## Status Bar

```
🟠 C 72% 1h 30m  |  🔵 O 85% 45m
```

- Indicator turns **yellow** when used usage reaches 70% or more.
- Indicator turns **red** when used usage reaches 85% or more.
- A warning icon is shown if usage data cannot be retrieved.

## Tooltip

Hover over either indicator to see a detailed table:

| | Used | Resets In |
|---|---|---|
| 5-Hour Session | **72%** | 1h 30m |
| 7-Day Weekly | **55%** | 3d 12h |

## Notes

- Claude usage is fetched via the Anthropic OAuth API using the local credentials file managed by Claude Code.
- Codex usage is fetched via `codex app-server` (`account/rateLimits/read`).
- If app-server is temporarily unavailable, the extension can still recover from local session data.
- No data is sent anywhere; everything runs locally.

## Quick Probe (Before Extension Debugging)

If you want to verify Codex rate-limit fetch works first:

```bash
npm run probe:codex-web
```

Then open:

```
http://127.0.0.1:47931
```

Use the button to run a one-shot `codex app-server` check and inspect the raw JSON response.

## License

This project is licensed under the MIT License. See `LICENSE` for details.
