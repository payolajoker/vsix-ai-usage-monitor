# Development and Debugging

Quick reference for running this extension locally in VS Code.

## 1) One-time setup

```bash
npm install
npm run compile
```

## 2) Debug profiles

This repo includes debug profiles in `.vscode/launch.json`:

- `Run Extension`
  - Launches an Extension Development Host
  - Runs `npm: compile` before launch
  - Uses `--disable-extensions` to reduce noise from unrelated extensions
- `Run Extension (No Compile)`
  - Same launch behavior, but skips pre-launch compile
  - Best used with watch mode running in a separate terminal

Both profiles set:

- `NODE_OPTIONS=--no-deprecation --no-warnings`
- `NODE_NO_WARNINGS=1`

This keeps debug console output focused on extension behavior.

## 3) Recommended inner loop

Terminal A:

```bash
npm run watch
```

Debug session:

1. Run `Run Extension` once.
2. For quick relaunches, use `Run Extension (No Compile)`.

## 4) Notes about runtime warnings

Warnings like Node deprecation or experimental runtime messages can come from VS
Code/Electron host internals, not from this extension logic. The debug profile
env settings above are used to reduce that noise during development.

## 5) Useful checks before commit

```bash
npm run compile
npm run test:tray
npm run release:check
```

## 6) Enable/Disable Providers via Env

Set `AI_USAGE_PROVIDERS` to control which providers are queried and shown:

- `AI_USAGE_PROVIDERS=codex`
- `AI_USAGE_PROVIDERS=claude`
- `AI_USAGE_PROVIDERS=claude,codex`
- `AI_USAGE_PROVIDERS=none`

For debug sessions, you can also place this in `.vscode/launch.json` under a
profile `env` block.

## 7) Running as an installed extension (non-debug)

To install and run the extension as a normal user-installed extension instead of
the Extension Development Host:

```bash
# Build and package in one step
npm run package:vsix

# Install into your running VS Code
code --install-extension ai-usage-statusbar-0.2.7.vsix --force
```

Then reload the VS Code window when prompted.

**Iteration workflow** (after changing source):

```bash
npm run package:vsix
code --install-extension ai-usage-statusbar-0.2.7.vsix --force
# Reload VS Code window
```

> Tip: bump `version` in `package.json` before re-packaging to avoid VS Code
> caching the old build.
