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
