/**
 * game-store.js ??gamedata.json ?곸냽???덉씠?? *
 * ?쎄린/?곌린/諛깆뾽/留덉씠洹몃젅?댁뀡
 * Electron main process?먯꽌留??ъ슜 (Node fs ?묎렐)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { GAMEDATA_VERSION, HISTORY_DAYS_FREE, HISTORY_WEEKS } = require('./game-config');

let _dataPath = null;
let _data = null;
let _dirty = false;

// ??? 珥덇린 ?ㅽ궎留????????????????????????????????????????????

function createDefaultData() {
  const now = new Date();
  return {
    version: GAMEDATA_VERSION,
    createdAt: now.toISOString(),

    // ?듭떖 吏꾪뻾
    xp: 0,
    level: 1,
    rebirthCount: 0,

    // 移?샇 & 肄붿뒪硫뷀떛
    activeTitle: null,
    activeSkin: 'robot',
    accessory1: null,
    accessory2: null,

    // ?닿툑
    unlockedSkins: ['robot'],
    unlockedAccessories: [],
    unlockedTitles: [],

    // ?낆쟻: { achievementId: isoTimestamp }
    achievements: {},

    // ?곗냽 ?묒냽
    currentStreak: 0,
    longestStreak: 0,
    lastLoginDate: null,

    // ?꾩쟻 移댁슫??
    totalHeartbeats: 0,
    totalUsageDetects: 0,
    totalPetClicks: 0,
    totalSkinChanges: 0,
    totalDrawerOpens: 0,
    totalResetsWitnessed: 0,
    totalDangerMinutes: 0,

    // ?쇱씪 移댁슫??(?먯젙留덈떎 由ъ뀑)
    daily: {
      date: _todayStr(),
      petClicks: 0,
      heartbeats: 0,
      usageDetects: 0,
      dangerEntries: 0,
      dualActives: 0,
      skinChanges: 0,
      drawerOpens: 0,
      earlyRefresh: 0,
      lateRefresh: 0,
      resetWitness: 0,
      xpEarned: 0,
      peakClaude5h: 0,
      peakCodex5h: 0,
    },

    // 二쇨컙 移댁슫??(?붿슂?쇰쭏??由ъ뀑)
    weekly: {
      weekStart: _mondayStr(),
      streakDays: 0,
      weeklyXp: 0,
      weeklyDanger: 0,
      weeklyDual: 0,
      weeklyHeartbeats: 0,
    },

    // 誘몄뀡 ?곹깭
    dailyMissions: {
      date: _todayStr(),
      missions: [],  // [{ id, progress, target, completed }]
    },
    weeklyMissions: {
      weekStart: _mondayStr(),
      missions: [],
    },

    // ?덉뒪?좊━
    dailyHistory: [],   // [{ date, xpEarned, heartbeats, peakClaude5h, peakCodex5h, ... }]
    weeklyHistory: [],  // [{ weekStart, totalXp, daysActive, ... }]

    // ?ъ슫???ㅼ젙
    soundEnabled: true,
    soundVolume: 0.3,
    windowPosition: null,

    // ?곗냽 ?섑듃鍮꾪듃 (???ъ떆????0)
    consecutiveHeartbeats: 0,

    // ?띾룄 異붿쟻 (SPEED DEMON ?낆쟻??
    usageSnapshots: [],  // [{ ts, claude5h, codex5h }] 理쒓렐 10媛?
  };
}

// ??? ?좎쭨 ?좏떥 ?????????????????????????????????????????????

function _todayStr() {
  return _toLocalDateStr(new Date());
}

function _mondayStr() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return _toLocalDateStr(mon);
}

function _toLocalDateStr(d) {
  return d.getFullYear()
    + '-'
    + String(d.getMonth() + 1).padStart(2, '0')
    + '-'
    + String(d.getDate()).padStart(2, '0');
}

// ??? 珥덇린??????????????????????????????????????????????????

/**
 * 寃뚯엫 ?곗씠??珥덇린?? * @param {string} userDataPath - app.getPath('userData')
 * @returns {object} gamedata
 */
function init(userDataPath) {
  _dataPath = path.join(userDataPath, 'gamedata.json');
  _data = _load();
  _rolloverCheck();
  return _data;
}

function _load() {
  try {
    if (fs.existsSync(_dataPath)) {
      const raw = fs.readFileSync(_dataPath, 'utf-8');
      const data = JSON.parse(raw);
      return _migrate(data);
    }
  } catch (err) {
    console.error('[GameStore] Failed to load gamedata.json, trying backup:', err.message);
    // 諛깆뾽 ?쒕룄
    const bakPath = _dataPath + '.bak';
    try {
      if (fs.existsSync(bakPath)) {
        const raw = fs.readFileSync(bakPath, 'utf-8');
        const data = JSON.parse(raw);
        console.log('[GameStore] Restored from backup');
        return _migrate(data);
      }
    } catch (bakErr) {
      console.error('[GameStore] Backup also failed:', bakErr.message);
    }
  }

  // ?좉퇋 ?앹꽦
  console.log('[GameStore] Creating new gamedata');
  const data = createDefaultData();
  _dirty = true;
  return data;
}

/**
 * 湲곗〈 localStorage ?ㅽ궓 ?ㅼ젙 留덉씠洹몃젅?댁뀡
 * (mini.html renderer?먯꽌 IPC濡??꾨떖諛쏆븘 ?몄텧)
 */
function migrateLegacySkin(skinId) {
  if (!_data) return;
  if (skinId && skinId !== 'robot') {
    _data.activeSkin = skinId;
    if (!_data.unlockedSkins.includes(skinId)) {
      _data.unlockedSkins.push(skinId);
    }
    _dirty = true;
  }
}

// ??? 留덉씠洹몃젅?댁뀡 ??????????????????????????????????????????

function _migrate(data) {
  if (!data.version) data.version = 0;
  if (!Object.prototype.hasOwnProperty.call(data, 'windowPosition')) data.windowPosition = null;

  // ?ν썑 ?ㅽ궎留?蹂寃????ш린???④퀎蹂?留덉씠洹몃젅?댁뀡 異붽?
  // if (data.version < 2) { ... data.version = 2; }

  data.version = GAMEDATA_VERSION;
  return data;
}

// ??? ?쇱씪/二쇨컙 濡ㅼ삤踰??????????????????????????????????????

function _rolloverCheck() {
  if (!_data) return;
  const today = _todayStr();
  const monday = _mondayStr();

  // 일일 롤오버
  if (_data.daily.date !== today) {
    // 이전 일일 데이터를 히스토리에 저장
    _archiveDaily();
    // 리셋
    _data.daily = {
      date: today,
      petClicks: 0,
      heartbeats: 0,
      usageDetects: 0,
      dangerEntries: 0,
      dualActives: 0,
      skinChanges: 0,
      drawerOpens: 0,
      earlyRefresh: 0,
      lateRefresh: 0,
      resetWitness: 0,
      xpEarned: 0,
      peakClaude5h: 0,
      peakCodex5h: 0,
    };
    // ?곗냽 ?섑듃鍮꾪듃 由ъ뀑 (?깆씠 ?먯젙 ?섍꺼???뚭퀬 ?덉뿀?????덉쑝誘濡??좎?)
    _data.dailyMissions = { date: today, missions: [] };
    _dirty = true;
  }

  // 주간 롤오버
  if (_data.weekly.weekStart !== monday) {
    _archiveWeekly();
    _data.weekly = {
      weekStart: monday,
      streakDays: 0,
      weeklyXp: 0,
      weeklyDanger: 0,
      weeklyDual: 0,
      weeklyHeartbeats: 0,
    };
    _data.weeklyMissions = { weekStart: monday, missions: [] };
    _dirty = true;
  }
}

function _archiveDaily() {
  if (!_data.daily || !_data.daily.date) return;
  _data.dailyHistory.push({
    date: _data.daily.date,
    xpEarned: _data.daily.xpEarned || 0,
    heartbeats: _data.daily.heartbeats || 0,
    peakClaude5h: _data.daily.peakClaude5h || 0,
    peakCodex5h: _data.daily.peakCodex5h || 0,
  });
  // ?덉뒪?좊━ ?ш린 ?쒗븳
  if (_data.dailyHistory.length > HISTORY_DAYS_FREE) {
    _data.dailyHistory = _data.dailyHistory.slice(-HISTORY_DAYS_FREE);
  }
}

function _archiveWeekly() {
  if (!_data.weekly || !_data.weekly.weekStart) return;
  _data.weeklyHistory.push({
    weekStart: _data.weekly.weekStart,
    totalXp: _data.weekly.weeklyXp || 0,
    heartbeats: _data.weekly.weeklyHeartbeats || 0,
  });
  if (_data.weeklyHistory.length > HISTORY_WEEKS) {
    _data.weeklyHistory = _data.weeklyHistory.slice(-HISTORY_WEEKS);
  }
}

// ??? ?????????????????????????????????????????????????????

/**
 * 蹂寃쎌궗?????(?붾컮?댁뒪 ??refresh 二쇨린??1???몄텧)
 */
function save() {
  if (!_dirty || !_dataPath || !_data) return;

  try {
    // 諛깆뾽
    if (fs.existsSync(_dataPath)) {
      fs.copyFileSync(_dataPath, _dataPath + '.bak');
    }
    // ???
    const dir = path.dirname(_dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(_dataPath, JSON.stringify(_data, null, 2), 'utf-8');
    _dirty = false;
  } catch (err) {
    console.error('[GameStore] Failed to save:', err.message);
  }
}

/**
 * 媛뺤젣 ???(??醫낅즺 ??
 */
function saveSync() {
  _dirty = true;
  save();
}

// ??? Getter / Setter ???????????????????????????????????????

function getData() {
  return _data;
}

function markDirty() {
  _dirty = true;
}

function isDirty() {
  return _dirty;
}

/**
 * 濡ㅼ삤踰?泥댄겕 (留?refresh留덈떎 ?몄텧)
 */
function checkRollover() {
  _rolloverCheck();
}

// ??? Exports ???????????????????????????????????????????????

module.exports = {
  init,
  save,
  saveSync,
  getData,
  markDirty,
  isDirty,
  checkRollover,
  migrateLegacySkin,
  createDefaultData,
};
