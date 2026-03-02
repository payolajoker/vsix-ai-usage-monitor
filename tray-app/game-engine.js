/**
 * game-engine.js — 게이미피케이션 핵심 로직
 *
 * processRefresh()  : 매 60초 refresh마다 호출 → XP/업적/미션 처리
 * processPetClick() : 고양이 클릭 시 호출
 * processInteraction() : UI 인터랙션 (스킨변경, 드로어열기) 시 호출
 * doRebirth()       : 환생 처리
 *
 * 순수 로직 모듈 — DOM 의존 없음
 */

'use strict';

const {
  XP_BASE, XP_EXPONENT, LEVEL_CAP, MAX_REBIRTH,
  XP_REWARDS, STREAK_XP_PER_DAY, STREAK_XP_CAP,
  PET_XP_DAILY_CAP, USAGE_SPIKE_THRESHOLD,
  ACHIEVEMENTS, SKIN_UNLOCKS, TITLE_UNLOCKS,
  DAILY_MISSIONS, WEEKLY_MISSIONS,
  DAILY_MISSION_COUNT, WEEKLY_MISSION_COUNT,
} = require('./game-config');

// ─── XP & 레벨 계산 ───────────────────────────────────────

/** 레벨 N에 필요한 XP (해당 레벨 도달에 필요한 단계 XP) */
function xpForLevel(n) {
  if (n <= 0) return 0;
  return Math.floor(XP_BASE * Math.pow(n, XP_EXPONENT));
}

/** 현재 레벨과 잔여 XP 계산 */
function calcLevel(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (level < LEVEL_CAP) {
    const needed = xpForLevel(level + 1);
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }
  return {
    level: Math.max(1, level),
    currentXp: remaining,
    nextLevelXp: level < LEVEL_CAP ? xpForLevel(level + 1) : 0,
  };
}

// ─── XP 부여 ───────────────────────────────────────────────

/**
 * @param {object} game - gamedata 참조 (직접 수정)
 * @param {number} amount - XP 양
 * @returns {number} 실제 부여된 XP
 */
function _awardXp(game, amount) {
  if (amount <= 0) return 0;
  game.xp += amount;
  game.daily.xpEarned = (game.daily.xpEarned || 0) + amount;
  game.weekly.weeklyXp = (game.weekly.weeklyXp || 0) + amount;
  return amount;
}

// ─── 메인 리프레시 처리 ────────────────────────────────────

/**
 * 매 60초 refresh 사이클마다 호출
 *
 * @param {object} game - gamedata (game-store.getData())
 * @param {object} payload - 현재 refresh 데이터
 *   { claude5h, codex5h, claudeTrend, codexTrend,
 *     claudeError, codexError, state, timestamp }
 * @returns {object} events
 *   { xpGained, levelUp, newLevel, newAchievements[], newSkinUnlocks[],
 *     newTitleUnlocks[], missionCompleted[], levelUpFrom }
 */
function processRefresh(game, payload) {
  const events = {
    xpGained: 0,
    levelUp: false,
    levelUpFrom: 0,
    newLevel: game.level,
    newAchievements: [],
    newSkinUnlocks: [],
    newTitleUnlocks: [],
    missionCompleted: [],
  };

  const now = new Date(payload.timestamp || Date.now());
  const hour = now.getHours();
  const prevLevel = game.level;

  // ── 1. 하트비트 XP ──
  events.xpGained += _awardXp(game, XP_REWARDS.HEARTBEAT);
  game.totalHeartbeats++;
  game.daily.heartbeats++;
  game.weekly.weeklyHeartbeats = (game.weekly.weeklyHeartbeats || 0) + 1;
  game.consecutiveHeartbeats = (game.consecutiveHeartbeats || 0) + 1;

  // ── 2. 사용량 변화 XP ──
  const claudeChanged = Math.abs(payload.claudeTrend || 0) >= 1;
  const codexChanged = Math.abs(payload.codexTrend || 0) >= 1;

  if (claudeChanged || codexChanged) {
    events.xpGained += _awardXp(game, XP_REWARDS.USAGE_CHANGE);
    game.totalUsageDetects++;
    game.daily.usageDetects++;
  }

  // ── 3. 사용량 급등 XP ──
  if ((payload.claudeTrend || 0) >= USAGE_SPIKE_THRESHOLD ||
      (payload.codexTrend || 0) >= USAGE_SPIKE_THRESHOLD) {
    events.xpGained += _awardXp(game, XP_REWARDS.USAGE_SPIKE);
  }

  // ── 4. 양쪽 동시 활성 XP ──
  const c5 = payload.claude5h || 0;
  const o5 = payload.codex5h || 0;
  if (c5 > 0 && o5 > 0 && !payload.claudeError && !payload.codexError) {
    events.xpGained += _awardXp(game, XP_REWARDS.DUAL_ACTIVE);
    game.daily.dualActives++;
    game.weekly.weeklyDual = (game.weekly.weeklyDual || 0) + 1;
  }

  // ── 5. 위험구간 XP ──
  if (payload.state === 'HIGH') {
    events.xpGained += _awardXp(game, XP_REWARDS.DANGER_ZONE);
    game.totalDangerMinutes++;
    game.daily.dangerEntries++;
    game.weekly.weeklyDanger = (game.weekly.weeklyDanger || 0) + 1;
  }

  // ── 6. 리셋 감지 ──
  if (payload.resetDetected) {
    events.xpGained += _awardXp(game, XP_REWARDS.RESET_WITNESS);
    game.totalResetsWitnessed++;
    game.daily.resetWitness++;
  }

  // ── 7. 데일리 로그인 + 스트릭 ──
  const today = now.toISOString().slice(0, 10);
  if (game.lastLoginDate !== today) {
    // 스트릭 체크
    if (game.lastLoginDate) {
      const lastDate = new Date(game.lastLoginDate + 'T00:00:00');
      const todayDate = new Date(today + 'T00:00:00');
      const diffDays = Math.round((todayDate - lastDate) / 86400000);
      if (diffDays === 1) {
        game.currentStreak++;
      } else {
        game.currentStreak = 1;
      }
    } else {
      game.currentStreak = 1;
    }

    if (game.currentStreak > game.longestStreak) {
      game.longestStreak = game.currentStreak;
    }

    // 주간 스트릭 카운터
    game.weekly.streakDays = (game.weekly.streakDays || 0) + 1;

    // 데일리 로그인 XP
    events.xpGained += _awardXp(game, XP_REWARDS.DAILY_LOGIN);

    // 스트릭 보너스 XP
    const streakBonus = Math.min(game.currentStreak * STREAK_XP_PER_DAY, STREAK_XP_CAP);
    events.xpGained += _awardXp(game, streakBonus);

    game.lastLoginDate = today;
  }

  // ── 8. 시간대 카운터 ──
  if (hour < 8) {
    game.daily.earlyRefresh = 1;
  }
  if (hour >= 22) {
    game.daily.lateRefresh = 1;
  }

  // ── 9. 피크 사용량 기록 ──
  if (c5 > (game.daily.peakClaude5h || 0)) game.daily.peakClaude5h = c5;
  if (o5 > (game.daily.peakCodex5h || 0)) game.daily.peakCodex5h = o5;

  // ── 10. 속도 추적 (SPEED DEMON용) ──
  if (!game.usageSnapshots) game.usageSnapshots = [];
  game.usageSnapshots.push({ ts: Date.now(), claude5h: c5, codex5h: o5 });
  if (game.usageSnapshots.length > 10) {
    game.usageSnapshots = game.usageSnapshots.slice(-10);
  }

  // ── 11. 레벨업 체크 ──
  const lvInfo = calcLevel(game.xp);
  if (lvInfo.level > prevLevel) {
    events.levelUp = true;
    events.levelUpFrom = prevLevel;
    events.newLevel = lvInfo.level;
    game.level = lvInfo.level;

    // 스킨 해금 체크
    for (const [skinId, info] of Object.entries(SKIN_UNLOCKS)) {
      if (info.unlockLevel <= game.level && !game.unlockedSkins.includes(skinId)) {
        game.unlockedSkins.push(skinId);
        events.newSkinUnlocks.push(skinId);
      }
    }

    // 칭호 해금 체크
    for (const ti of TITLE_UNLOCKS) {
      if (ti.level <= game.level && !game.unlockedTitles.includes(ti.title)) {
        game.unlockedTitles.push(ti.title);
        events.newTitleUnlocks.push(ti.title);
      }
    }
  } else {
    game.level = lvInfo.level;
  }

  // ── 12. 업적 체크 ──
  const ctx = _buildAchievementContext(game, payload, now);
  for (const ach of ACHIEVEMENTS) {
    if (game.achievements[ach.id]) continue;  // 이미 달성
    if (_checkAchievement(ach.id, ctx, game)) {
      game.achievements[ach.id] = now.toISOString();
      events.newAchievements.push(ach);
      events.xpGained += _awardXp(game, ach.xp);
    }
  }

  // ── 13. 미션 진행 체크 ──
  _updateMissions(game, events);

  return events;
}

// ─── 업적 컨텍스트 빌드 ────────────────────────────────────

function _buildAchievementContext(game, payload, now) {
  return {
    hour: now.getHours(),
    dayOfWeek: now.getDay(),
    claude5h: payload.claude5h || 0,
    codex5h: payload.codex5h || 0,
    claudeTrend: payload.claudeTrend || 0,
    codexTrend: payload.codexTrend || 0,
    claudeError: !!payload.claudeError,
    codexError: !!payload.codexError,
    state: payload.state || 'CALM',
    consecutiveHeartbeats: game.consecutiveHeartbeats || 0,
    currentStreak: game.currentStreak,
    longestStreak: game.longestStreak,
    totalPetClicks: game.totalPetClicks,
    totalSkinChanges: game.totalSkinChanges,
    totalDrawerOpens: game.totalDrawerOpens,
    totalResetsWitnessed: game.totalResetsWitnessed,
    level: game.level,
    rebirthCount: game.rebirthCount,
    unlockedSkinsCount: game.unlockedSkins.length,
    achievementCount: Object.keys(game.achievements).length,
    usageSnapshots: game.usageSnapshots || [],
  };
}

// ─── 업적 개별 체크 ────────────────────────────────────────

function _checkAchievement(id, ctx, game) {
  switch (id) {
    // 가동시간
    case 'first_boot':       return true;  // 첫 refresh에서 무조건 달성
    case 'early_bird':       return ctx.hour < 7;
    case 'night_owl':        return ctx.hour >= 0 && ctx.hour < 4;
    case 'marathon':         return ctx.consecutiveHeartbeats >= 480;    // 8시간
    case 'ironman':          return ctx.consecutiveHeartbeats >= 1440;   // 24시간
    case 'weekender':        return _checkWeekender(game);
    case 'full_week':        return ctx.currentStreak >= 7;
    case 'monthly_devotion': return ctx.currentStreak >= 30;
    case 'quarterly_grind':  return ctx.currentStreak >= 90;

    // 사용 패턴
    case 'first_steps':      return ctx.claudeTrend > 0 || ctx.codexTrend > 0;
    case 'power_user':       return ctx.claude5h >= 50 || ctx.codex5h >= 50;
    case 'danger_zone':      return ctx.claude5h >= 85 || ctx.codex5h >= 85;
    case 'maxed_out':        return ctx.claude5h >= 99 || ctx.codex5h >= 99;
    case 'dual_wielder':     return ctx.claude5h > 0 && ctx.codex5h > 0 && !ctx.claudeError && !ctx.codexError;
    case 'balanced':         return ctx.claude5h >= 20 && ctx.codex5h >= 20 && Math.abs(ctx.claude5h - ctx.codex5h) <= 10;
    case 'claude_loyalist':  return ctx.claude5h >= 70 && ctx.codex5h === 0;
    case 'codex_devotee':    return ctx.codex5h >= 70 && ctx.claude5h === 0;
    case 'fresh_start':      return ctx.totalResetsWitnessed >= 1;
    case 'phoenix':          return ctx.totalResetsWitnessed >= 10;
    case 'eternal_cycle':    return ctx.totalResetsWitnessed >= 100;

    // 성장
    case 'level_10':         return ctx.level >= 10;
    case 'level_25':         return ctx.level >= 25;
    case 'level_50':         return ctx.level >= 50;
    case 'reborn':           return ctx.rebirthCount >= 1;
    case 'skin_collector':   return ctx.unlockedSkinsCount >= 6;
    case 'fashionista':      return ctx.unlockedSkinsCount >= 12;

    // 인터랙션
    case 'pet_the_cat':      return ctx.totalPetClicks >= 10;
    case 'cat_whisperer':    return ctx.totalPetClicks >= 100;
    case 'style_switch':     return ctx.totalSkinChanges >= 20;
    case 'drawer_explorer':  return ctx.totalDrawerOpens >= 50;

    // 시크릿
    case 'not_found':           return ctx.claudeError && ctx.codexError;
    case 'perfectly_balanced':  return ctx.claude5h === 50 && ctx.codex5h === 50;
    case 'midnight_coder':      return ctx.hour === 3 && (ctx.claude5h >= 70 || ctx.codex5h >= 70);
    case 'speed_demon':         return _checkSpeedDemon(ctx);
    case 'the_collector':       return _checkCollector(ctx, game);

    default: return false;
  }
}

function _checkWeekender(game) {
  // 히스토리에서 같은 주의 토+일 모두 로그인 확인
  const history = game.dailyHistory || [];
  const recent = history.slice(-14);  // 최근 2주

  for (let i = 0; i < recent.length; i++) {
    const d = new Date(recent[i].date + 'T00:00:00');
    if (d.getDay() === 6) {  // 토요일
      // 다음날(일요일) 있는지
      const nextDay = new Date(d);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextStr = nextDay.toISOString().slice(0, 10);
      if (recent.some(r => r.date === nextStr)) return true;
      // 또는 오늘이 일요일이고 어제가 토요일인 경우
    }
  }

  // 현재 세션도 체크
  const today = new Date();
  const todayDay = today.getDay();
  const todayStr = today.toISOString().slice(0, 10);

  if (todayDay === 0) {  // 일요일
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    if (recent.some(r => r.date === yStr) || game.lastLoginDate === yStr) return true;
  } else if (todayDay === 6) {  // 토요일
    // 내일이 일요일이고 로그인하면 달성되지만, 아직 달성 아님
  }

  return false;
}

function _checkSpeedDemon(ctx) {
  // 최근 10개 스냅샷 중 5개(=5분) 이내에 0→50 급등
  const snaps = ctx.usageSnapshots;
  if (snaps.length < 2) return false;

  const latest = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) {
    const old = snaps[i];
    const timeDiff = latest.ts - old.ts;
    if (timeDiff > 600000) continue;  // 10분 초과 건너뛰기

    if ((old.claude5h <= 5 && latest.claude5h >= 50) ||
        (old.codex5h <= 5 && latest.codex5h >= 50)) {
      return true;
    }
  }
  return false;
}

function _checkCollector(ctx, game) {
  // 시크릿 제외 전 업적 달성 확인
  const nonSecret = ACHIEVEMENTS.filter(a => !a.hidden);
  return nonSecret.every(a => !!game.achievements[a.id]);
}

// ─── 미션 관리 ─────────────────────────────────────────────

/**
 * 미션이 비어있으면 생성
 */
function ensureMissions(game) {
  const today = game.daily.date;

  // 일일 미션
  if (!game.dailyMissions.missions || game.dailyMissions.missions.length === 0) {
    game.dailyMissions = {
      date: today,
      missions: _generateMissions(DAILY_MISSIONS, DAILY_MISSION_COUNT, game.level),
    };
  }

  // 주간 미션 (LV5 이상)
  if (game.level >= 5) {
    if (!game.weeklyMissions.missions || game.weeklyMissions.missions.length === 0) {
      game.weeklyMissions = {
        weekStart: game.weekly.weekStart,
        missions: _generateMissions(WEEKLY_MISSIONS, WEEKLY_MISSION_COUNT, game.level),
      };
    }
  }
}

function _generateMissions(pool, count, level) {
  // 레벨에 맞는 미션 필터링
  const available = pool.filter(m => (m.minLevel || 1) <= level);

  // family별 그룹핑 → 각 family에서 1개만
  const byFamily = {};
  for (const m of available) {
    if (!byFamily[m.family]) byFamily[m.family] = [];
    byFamily[m.family].push(m);
  }

  // 높은 레벨에서는 어려운 변형 우선
  const selected = [];
  const families = Object.keys(byFamily);
  _shuffle(families);

  for (const fam of families) {
    if (selected.length >= count) break;
    const variants = byFamily[fam];
    // 레벨 20 이상이면 어려운 변형 우선, 아니면 랜덤
    let pick;
    if (level >= 20 && variants.length > 1) {
      pick = variants[variants.length - 1];  // 마지막 = 높은 minLevel
    } else {
      pick = variants[Math.floor(Math.random() * variants.length)];
    }
    selected.push({
      id: pick.id,
      progress: 0,
      target: pick.target,
      completed: false,
    });
  }

  return selected;
}

function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function _updateMissions(game, events) {
  ensureMissions(game);

  // 카운터 매핑: counter이름 → 현재 값
  const counters = {
    heartbeats: game.daily.heartbeats,
    petClicks: game.daily.petClicks,
    usageDetects: game.daily.usageDetects,
    dangerEntries: game.daily.dangerEntries,
    dualActives: game.daily.dualActives,
    skinChanges: game.daily.skinChanges,
    drawerOpens: game.daily.drawerOpens,
    earlyRefresh: game.daily.earlyRefresh,
    lateRefresh: game.daily.lateRefresh,
    resetWitness: game.daily.resetWitness,
    // 주간
    streakDays: game.weekly.streakDays,
    weeklyXp: game.weekly.weeklyXp,
    weeklyDanger: game.weekly.weeklyDanger,
    weeklyDual: game.weekly.weeklyDual,
    weeklyHeartbeats: game.weekly.weeklyHeartbeats,
  };

  // 미션 풀 맵 (id → mission def)
  const missionDefs = {};
  for (const m of [...DAILY_MISSIONS, ...WEEKLY_MISSIONS]) {
    missionDefs[m.id] = m;
  }

  // 일일 미션 진행
  for (const m of game.dailyMissions.missions) {
    if (m.completed) continue;
    const def = missionDefs[m.id];
    if (!def) continue;
    const val = counters[def.counter] || 0;
    m.progress = Math.min(val, m.target);
    if (m.progress >= m.target && !m.completed) {
      m.completed = true;
      events.missionCompleted.push(def);
      events.xpGained += _awardXp(game, def.xp);
    }
  }

  // 주간 미션 진행
  if (game.weeklyMissions.missions) {
    for (const m of game.weeklyMissions.missions) {
      if (m.completed) continue;
      const def = missionDefs[m.id];
      if (!def) continue;
      const val = counters[def.counter] || 0;
      m.progress = Math.min(val, m.target);
      if (m.progress >= m.target && !m.completed) {
        m.completed = true;
        events.missionCompleted.push(def);
        events.xpGained += _awardXp(game, def.xp);
      }
    }
  }
}

// ─── 인터랙션 처리 ─────────────────────────────────────────

/**
 * 고양이 쓰다듬기 (클릭)
 * @returns {{ xpGained: number, newAchievements: object[] }}
 */
function processPetClick(game) {
  const events = { xpGained: 0, newAchievements: [] };

  game.totalPetClicks++;
  game.daily.petClicks++;

  // 일일 캡 체크
  if (game.daily.petClicks <= PET_XP_DAILY_CAP) {
    events.xpGained += _awardXp(game, XP_REWARDS.PET_CAT);
  }

  // 업적 체크 (pet 관련만)
  if (!game.achievements.pet_the_cat && game.totalPetClicks >= 10) {
    game.achievements.pet_the_cat = new Date().toISOString();
    const ach = ACHIEVEMENTS.find(a => a.id === 'pet_the_cat');
    events.newAchievements.push(ach);
    events.xpGained += _awardXp(game, ach.xp);
  }
  if (!game.achievements.cat_whisperer && game.totalPetClicks >= 100) {
    game.achievements.cat_whisperer = new Date().toISOString();
    const ach = ACHIEVEMENTS.find(a => a.id === 'cat_whisperer');
    events.newAchievements.push(ach);
    events.xpGained += _awardXp(game, ach.xp);
  }

  // 미션 진행
  _updateMissionCounter(game, 'petClicks', game.daily.petClicks, events);

  // 레벨업 체크
  _checkLevelUp(game, events);

  return events;
}

/**
 * UI 인터랙션 (스킨변경, 드로어열기)
 * @param {'skinChange'|'drawerOpen'} type
 */
function processInteraction(game, type) {
  const events = { xpGained: 0, newAchievements: [] };

  if (type === 'skinChange') {
    game.totalSkinChanges++;
    game.daily.skinChanges++;
    if (!game.achievements.style_switch && game.totalSkinChanges >= 20) {
      game.achievements.style_switch = new Date().toISOString();
      const ach = ACHIEVEMENTS.find(a => a.id === 'style_switch');
      events.newAchievements.push(ach);
      events.xpGained += _awardXp(game, ach.xp);
    }
    _updateMissionCounter(game, 'skinChanges', game.daily.skinChanges, events);
  } else if (type === 'drawerOpen') {
    game.totalDrawerOpens++;
    game.daily.drawerOpens++;
    if (!game.achievements.drawer_explorer && game.totalDrawerOpens >= 50) {
      game.achievements.drawer_explorer = new Date().toISOString();
      const ach = ACHIEVEMENTS.find(a => a.id === 'drawer_explorer');
      events.newAchievements.push(ach);
      events.xpGained += _awardXp(game, ach.xp);
    }
    _updateMissionCounter(game, 'drawerOpens', game.daily.drawerOpens, events);
  }

  _checkLevelUp(game, events);
  return events;
}

function _updateMissionCounter(game, counter, value, events) {
  const missionDefs = {};
  for (const m of [...DAILY_MISSIONS, ...WEEKLY_MISSIONS]) {
    missionDefs[m.id] = m;
  }

  for (const m of game.dailyMissions.missions) {
    if (m.completed) continue;
    const def = missionDefs[m.id];
    if (!def || def.counter !== counter) continue;
    m.progress = Math.min(value, m.target);
    if (m.progress >= m.target) {
      m.completed = true;
      events.missionCompleted = events.missionCompleted || [];
      events.missionCompleted.push(def);
      events.xpGained += _awardXp(game, def.xp);
    }
  }
}

function _checkLevelUp(game, events) {
  const lvInfo = calcLevel(game.xp);
  if (lvInfo.level > game.level) {
    events.levelUp = true;
    events.levelUpFrom = game.level;
    events.newLevel = lvInfo.level;
    game.level = lvInfo.level;

    // 스킨/칭호 해금
    for (const [skinId, info] of Object.entries(SKIN_UNLOCKS)) {
      if (info.unlockLevel <= game.level && !game.unlockedSkins.includes(skinId)) {
        game.unlockedSkins.push(skinId);
        events.newSkinUnlocks = events.newSkinUnlocks || [];
        events.newSkinUnlocks.push(skinId);
      }
    }
    for (const ti of TITLE_UNLOCKS) {
      if (ti.level <= game.level && !game.unlockedTitles.includes(ti.title)) {
        game.unlockedTitles.push(ti.title);
        events.newTitleUnlocks = events.newTitleUnlocks || [];
        events.newTitleUnlocks.push(ti.title);
      }
    }
  }
  game.level = lvInfo.level;
}

// ─── 환생 ──────────────────────────────────────────────────

/**
 * 환생 처리
 * @returns {{ success: boolean, rebirthCount: number }}
 */
function doRebirth(game) {
  if (game.level < LEVEL_CAP) return { success: false };
  if (game.rebirthCount >= MAX_REBIRTH) return { success: false };

  game.rebirthCount++;
  game.xp = 0;
  game.level = 1;
  // 스킨, 업적, 악세서리는 유지
  // 칭호도 유지

  return { success: true, rebirthCount: game.rebirthCount };
}

// ─── 유틸 ──────────────────────────────────────────────────

/**
 * 렌더러에 보낼 게임 상태 요약
 */
function getGameSummary(game) {
  const lvInfo = calcLevel(game.xp);
  return {
    level: game.level,
    xp: game.xp,
    currentXp: lvInfo.currentXp,
    nextLevelXp: lvInfo.nextLevelXp,
    xpProgress: lvInfo.nextLevelXp > 0 ? lvInfo.currentXp / lvInfo.nextLevelXp : 1,
    rebirthCount: game.rebirthCount,
    activeTitle: game.activeTitle,
    activeSkin: game.activeSkin,
    unlockedSkins: game.unlockedSkins,
    unlockedTitles: game.unlockedTitles,
    achievementCount: Object.keys(game.achievements).length,
    totalAchievements: ACHIEVEMENTS.length,
    earnedAchievements: Object.keys(game.achievements),
    currentStreak: game.currentStreak,
    longestStreak: game.longestStreak,
    dailyMissions: game.dailyMissions,
    weeklyMissions: game.weeklyMissions,
    soundEnabled: game.soundEnabled,
    soundVolume: game.soundVolume,
    todayXp: game.daily.xpEarned || 0,
    dailyHistory: game.dailyHistory || [],
    weeklyHistory: game.weeklyHistory || [],
    stats: {
      totalHeartbeats: game.totalHeartbeats || 0,
      totalUsageDetects: game.totalUsageDetects || 0,
      totalPetClicks: game.totalPetClicks || 0,
      totalSkinChanges: game.totalSkinChanges || 0,
      totalDrawerOpens: game.totalDrawerOpens || 0,
      totalResetsWitnessed: game.totalResetsWitnessed || 0,
      totalDangerMinutes: game.totalDangerMinutes || 0,
    },
  };
}

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  xpForLevel,
  calcLevel,
  processRefresh,
  processPetClick,
  processInteraction,
  doRebirth,
  ensureMissions,
  getGameSummary,
};
