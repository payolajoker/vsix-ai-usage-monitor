'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gameStore = require('../game-store');
const { HISTORY_DAYS_FREE } = require('../game-config');

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-tray-test-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeGameData(dir, data) {
  fs.writeFileSync(path.join(dir, 'gamedata.json'), JSON.stringify(data, null, 2), 'utf8');
}

test('init rolls over daily data and archives prior day stats', () => {
  withTempDir((dir) => {
    const seeded = gameStore.createDefaultData();
    const oldDate = '2000-01-01';

    seeded.daily.date = oldDate;
    seeded.daily.xpEarned = 123;
    seeded.daily.heartbeats = 9;
    seeded.daily.peakClaude5h = 55;
    seeded.daily.peakCodex5h = 47;

    writeGameData(dir, seeded);
    gameStore.init(dir);
    const loaded = gameStore.getData();

    assert.notEqual(loaded.daily.date, oldDate);
    assert.equal(loaded.daily.xpEarned, 0);
    assert.equal(loaded.daily.heartbeats, 0);

    const archived = loaded.dailyHistory[loaded.dailyHistory.length - 1];
    assert.equal(archived.date, oldDate);
    assert.equal(archived.xpEarned, 123);
    assert.equal(archived.heartbeats, 9);
    assert.equal(archived.peakClaude5h, 55);
    assert.equal(archived.peakCodex5h, 47);
  });
});

test('init rolls over weekly data and archives prior week stats', () => {
  withTempDir((dir) => {
    const seeded = gameStore.createDefaultData();
    const oldWeekStart = '2000-01-03';

    seeded.weekly.weekStart = oldWeekStart;
    seeded.weekly.weeklyXp = 777;
    seeded.weekly.weeklyHeartbeats = 321;

    writeGameData(dir, seeded);
    gameStore.init(dir);
    const loaded = gameStore.getData();

    assert.notEqual(loaded.weekly.weekStart, oldWeekStart);
    assert.equal(loaded.weekly.weeklyXp, 0);
    assert.equal(loaded.weekly.weeklyHeartbeats, 0);

    const archived = loaded.weeklyHistory[loaded.weeklyHistory.length - 1];
    assert.equal(archived.weekStart, oldWeekStart);
    assert.equal(archived.totalXp, 777);
    assert.equal(archived.heartbeats, 321);
  });
});

test('daily history keeps retention cap after rollover archive', () => {
  withTempDir((dir) => {
    const seeded = gameStore.createDefaultData();
    seeded.daily.date = '1999-12-31';
    seeded.dailyHistory = Array.from({ length: HISTORY_DAYS_FREE + 5 }, (_, index) => ({
      date: `2025-01-${String((index % 28) + 1).padStart(2, '0')}`,
      xpEarned: index,
      heartbeats: index,
      peakClaude5h: 0,
      peakCodex5h: 0,
    }));

    writeGameData(dir, seeded);
    gameStore.init(dir);
    const loaded = gameStore.getData();

    assert.ok(loaded.dailyHistory.length <= HISTORY_DAYS_FREE);
    assert.equal(loaded.dailyHistory[loaded.dailyHistory.length - 1].date, '1999-12-31');
  });
});
