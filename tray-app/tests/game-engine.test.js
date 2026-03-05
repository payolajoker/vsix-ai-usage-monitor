'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const gameEngine = require('../game-engine');
const gameStore = require('../game-store');
const { PET_XP_DAILY_CAP } = require('../game-config');

function isoAtNoon(dateStr) {
  return `${dateStr}T12:00:00.000Z`;
}

test('processRefresh levels up when XP reaches threshold', () => {
  const game = gameStore.createDefaultData();
  const today = '2026-03-01';
  const level2Threshold = gameEngine.xpForLevel(1) + gameEngine.xpForLevel(2);

  game.xp = level2Threshold - 1;
  game.level = 1;
  game.lastLoginDate = today;
  game.achievements.first_boot = '2026-03-01T00:00:00.000Z';

  const events = gameEngine.processRefresh(game, {
    claude5h: 0,
    codex5h: 0,
    claudeTrend: 0,
    codexTrend: 0,
    claudeError: false,
    codexError: false,
    state: 'CALM',
    timestamp: isoAtNoon(today),
    resetDetected: false,
  });

  assert.equal(events.levelUp, true);
  assert.equal(events.levelUpFrom, 1);
  assert.equal(game.level, 2);
  assert.equal(game.totalHeartbeats, 1);
});

test('processRefresh completes daily mission when counter target is met', () => {
  const game = gameStore.createDefaultData();
  const today = new Date().toISOString().slice(0, 10);

  game.lastLoginDate = today;
  game.achievements.first_boot = '2026-03-01T00:00:00.000Z';
  game.daily.usageDetects = 2;
  game.dailyMissions = {
    date: today,
    missions: [
      {
        id: 'usage_detect_3',
        progress: 2,
        target: 3,
        completed: false,
      },
    ],
  };

  const events = gameEngine.processRefresh(game, {
    claude5h: 10,
    codex5h: 0,
    claudeTrend: 1,
    codexTrend: 0,
    claudeError: false,
    codexError: false,
    state: 'USING',
    timestamp: isoAtNoon(today),
    resetDetected: false,
  });

  assert.equal(game.daily.usageDetects, 3);
  assert.equal(game.dailyMissions.missions[0].completed, true);
  assert.ok(
    Array.isArray(events.missionCompleted)
      && events.missionCompleted.some((mission) => mission && mission.id === 'usage_detect_3'),
    'Expected usage_detect_3 to be marked complete'
  );
});

test('processPetClick does not grant click XP past daily cap', () => {
  const game = gameStore.createDefaultData();

  game.daily.petClicks = PET_XP_DAILY_CAP;
  game.totalPetClicks = 0;

  const events = gameEngine.processPetClick(game);

  assert.equal(game.daily.petClicks, PET_XP_DAILY_CAP + 1);
  assert.equal(events.xpGained, 0);
});
