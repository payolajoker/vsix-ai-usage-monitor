# Changelog

All notable changes to this project are documented in this file.

## 0.2.6

- Combined Claude and Codex into one status bar indicator to prevent split/interleaving with other status bar items.
- Switched Codex usage fetch to `codex app-server` (`account/rateLimits/read`) with session-file fallback.
- Added a local web probe script (`npm run probe:codex-web`) for quick rate-limit fetch verification.
- Updated documentation for new Codex source and probe workflow.

## 0.2.7

- Restored separate Claude and Codex status bar indicators to preserve distinct base colors.
- Updated Marketplace README details to remove `sessions` from Requirements and emphasize app-server usage.
- Kept Codex app-server based fetching in extension runtime.
