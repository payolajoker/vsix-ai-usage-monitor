#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const NODE_CMD = process.execPath;
const NPM_CMD = 'npm';

function runCommand(command, args, options = {}) {
  const useShell = Boolean(options.shell);
  let result;

  if (useShell && process.platform === 'win32') {
    const cmd = process.env.ComSpec || 'cmd.exe';
    const commandLine = [command, ...args].map(quoteForCmd).join(' ');
    result = spawnSync(cmd, ['/d', '/s', '/c', commandLine], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } else {
    result = spawnSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: useShell,
    });
  }

  if (result.error) {
    throw new Error(`Command failed to start: ${command} ${args.join(' ')} (${result.error.message})`);
  }

  if (result.status !== 0) {
    const stdout = result.stdout ? `\n[stdout]\n${result.stdout.trimEnd()}` : '';
    const stderr = result.stderr ? `\n[stderr]\n${result.stderr.trimEnd()}` : '';
    throw new Error(`Command failed: ${command} ${args.join(' ')}${stdout}${stderr}`);
  }
}

function quoteForCmd(value) {
  const text = String(value);
  if (!/[\s"]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function readText(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
}

function checkVersionReferences() {
  const rootPackage = readJson('package.json');
  const trayPackage = readJson(path.join('tray-app', 'package.json'));

  const rootVersion = String(rootPackage.version || '').trim();
  const trayVersion = String(trayPackage.version || '').trim();

  if (!rootVersion) {
    throw new Error('Root package version is empty.');
  }
  if (!trayVersion) {
    throw new Error('Tray package version is empty.');
  }

  const checks = [
    { file: 'README.md', versions: [rootVersion, trayVersion] },
    { file: 'PROJECT_ANALYSIS.md', versions: [rootVersion, trayVersion] },
    { file: 'SESSION_HANDOFF.md', versions: [rootVersion, trayVersion] },
    { file: path.join('tray-app', 'README.md'), versions: [trayVersion] },
  ];

  const missing = [];
  for (const item of checks) {
    const text = readText(item.file);
    for (const version of item.versions) {
      if (!text.includes(version)) {
        missing.push(`${item.file} missing version ${version}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Version/document sync check failed:\n- ${missing.join('\n- ')}`);
  }
}

const steps = [
  {
    name: 'Compile extension TypeScript',
    run: () => runCommand(NPM_CMD, ['run', 'compile'], { shell: true }),
  },
  {
    name: 'Syntax check tray main process',
    run: () => runCommand(NODE_CMD, ['--check', path.join('tray-app', 'main.js')]),
  },
  {
    name: 'Syntax check tray provider adapter',
    run: () => runCommand(NODE_CMD, ['--check', path.join('tray-app', 'provider-adapter.js')]),
  },
  {
    name: 'Run tray tests',
    run: () => runCommand(NPM_CMD, ['--prefix', 'tray-app', 'test'], { shell: true }),
  },
  {
    name: 'Check document/version sync',
    run: () => checkVersionReferences(),
  },
];

let failed = 0;

console.log('AI Usage Monitor release gate');
for (const step of steps) {
  process.stdout.write(`- ${step.name} ... `);
  try {
    step.run();
    console.log('PASS');
  } catch (error) {
    failed += 1;
    console.log('FAIL');
    console.error(String(error && error.message ? error.message : error));
  }
}

if (failed > 0) {
  console.error(`\nRelease gate failed (${failed} step${failed > 1 ? 's' : ''}).`);
  process.exit(1);
}

console.log('\nRelease gate passed.');
