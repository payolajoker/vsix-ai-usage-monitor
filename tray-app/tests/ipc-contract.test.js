'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');

function collectIpcRegistrations(sourceText) {
  const registrations = {
    handle: new Set(),
    on: new Set(),
  };

  const pattern = /ipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]/g;
  let match = null;
  while ((match = pattern.exec(sourceText)) !== null) {
    registrations[match[1]].add(match[2]);
  }

  return registrations;
}

test('tray main process registers required IPC channels', () => {
  const source = fs.readFileSync(MAIN_PATH, 'utf8');
  const registrations = collectIpcRegistrations(source);

  const required = {
    handle: [
      'mini-toggle-details',
      'game-pet-click',
      'game-set-skin',
      'game-set-sound',
    ],
    on: [
      'mini-toggle-details',
      'mini-inline-expand',
    ],
  };

  for (const method of Object.keys(required)) {
    const missing = required[method].filter((channel) => !registrations[method].has(channel));
    assert.equal(
      missing.length,
      0,
      `Missing ipcMain.${method} channel(s): ${missing.join(', ')}`
    );
  }
});
