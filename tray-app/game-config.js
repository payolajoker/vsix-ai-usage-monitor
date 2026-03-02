/**
 * game-config.js — 게이미피케이션 상수 및 정의
 *
 * XP 곡선, 업적 정의, 미션 풀, 스킨 해금표, 악세서리 등
 * 순수 데이터 모듈 — 로직 없음
 */

'use strict';

// ─── XP & 레벨 ────────────────────────────────────────────

/** 레벨 N에 필요한 XP = floor(80 × N^1.6) */
const XP_BASE = 80;
const XP_EXPONENT = 1.6;
const LEVEL_CAP = 50;
const MAX_REBIRTH = 9;

/** XP 소스별 보상 */
const XP_REWARDS = {
  HEARTBEAT:       1,   // 60초마다 (fetch 성공)
  USAGE_CHANGE:    3,   // 사용량 변화 감지 (trend > 0)
  USAGE_SPIKE:     8,   // 사용량 급등 (delta ≥ 5%)
  DUAL_ACTIVE:     2,   // 양쪽 제공자 동시 활성
  DANGER_ZONE:     5,   // 위험구간 (≥ 85%) 생존
  RESET_WITNESS:  25,   // 리셋 목격 (50% → <10%)
  DAILY_LOGIN:    50,   // 하루 첫 접속
  PET_CAT:         1,   // 고양이 쓰다듬기 (클릭)
};

/** 연속 접속 보너스: +10 × streak (최대 +100) */
const STREAK_XP_PER_DAY = 10;
const STREAK_XP_CAP = 100;

/** 고양이 쓰다듬기 일일 XP 캡 */
const PET_XP_DAILY_CAP = 10;

/** 사용량 급등 기준 (%) */
const USAGE_SPIKE_THRESHOLD = 5;

// ─── 업적 ──────────────────────────────────────────────────

const RARITY = {
  COMMON:    { id: 'COMMON',    color: '#f4ecff', label: 'COMMON' },
  RARE:      { id: 'RARE',      color: '#7cc6ff', label: 'RARE' },
  EPIC:      { id: 'EPIC',      color: '#c87cff', label: 'EPIC' },
  LEGENDARY: { id: 'LEGENDARY', color: '#ffb76d', label: 'LEGENDARY' },
  SECRET:    { id: 'SECRET',    color: '#ff7e7e', label: 'SECRET' },
};

/**
 * 업적 정의 — 35개
 * check(ctx, game) → boolean   (game-engine에서 평가)
 * ctx: 현재 refresh 컨텍스트 (사용량, 시간 등)
 * game: gamedata 전체 상태
 */
const ACHIEVEMENTS = [
  // ── 가동시간 ──
  { id: 'first_boot',       name: 'FIRST BOOT',       desc: '첫 실행',                        rarity: RARITY.COMMON,    xp: 50,  category: 'UPTIME' },
  { id: 'early_bird',       name: 'EARLY BIRD',        desc: '오전 7시 이전 가동',              rarity: RARITY.COMMON,    xp: 50,  category: 'UPTIME' },
  { id: 'night_owl',        name: 'NIGHT OWL',         desc: '자정~새벽 4시 사이 가동',          rarity: RARITY.COMMON,    xp: 50,  category: 'UPTIME' },
  { id: 'marathon',         name: 'MARATHON',          desc: '8시간 연속 가동',                 rarity: RARITY.RARE,      xp: 100, category: 'UPTIME' },
  { id: 'ironman',          name: 'IRONMAN',           desc: '24시간 연속 가동',                rarity: RARITY.EPIC,      xp: 200, category: 'UPTIME' },
  { id: 'weekender',        name: 'WEEKENDER',         desc: '토요일+일요일 모두 사용',          rarity: RARITY.COMMON,    xp: 75,  category: 'UPTIME' },
  { id: 'full_week',        name: 'FULL WEEK',         desc: '7일 연속 로그인',                 rarity: RARITY.RARE,      xp: 150, category: 'UPTIME' },
  { id: 'monthly_devotion', name: 'MONTHLY DEVOTION',  desc: '30일 연속 로그인',                rarity: RARITY.EPIC,      xp: 300, category: 'UPTIME' },
  { id: 'quarterly_grind',  name: 'QUARTERLY GRIND',   desc: '90일 연속 로그인',                rarity: RARITY.LEGENDARY, xp: 500, category: 'UPTIME' },

  // ── 사용 패턴 ──
  { id: 'first_steps',      name: 'FIRST STEPS',       desc: '첫 AI 사용 감지',                rarity: RARITY.COMMON,    xp: 50,  category: 'USAGE' },
  { id: 'power_user',       name: 'POWER USER',        desc: '5h 사용량 50% 도달',             rarity: RARITY.COMMON,    xp: 75,  category: 'USAGE' },
  { id: 'danger_zone',      name: 'DANGER ZONE',       desc: '5h 사용량 85% 도달',             rarity: RARITY.RARE,      xp: 100, category: 'USAGE' },
  { id: 'maxed_out',        name: 'MAXED OUT',         desc: '5h 사용량 99%+ 도달',            rarity: RARITY.EPIC,      xp: 200, category: 'USAGE' },
  { id: 'dual_wielder',     name: 'DUAL WIELDER',      desc: 'Claude + Codex 동시 활성',        rarity: RARITY.RARE,      xp: 100, category: 'USAGE' },
  { id: 'balanced',         name: 'BALANCED',          desc: '양쪽 차이 10% 이내 (둘 다 20%+)', rarity: RARITY.RARE,      xp: 150, category: 'USAGE' },
  { id: 'claude_loyalist',  name: 'CLAUDE LOYALIST',   desc: 'Claude 70%+ / Codex 0%',         rarity: RARITY.RARE,      xp: 100, category: 'USAGE' },
  { id: 'codex_devotee',    name: 'CODEX DEVOTEE',     desc: 'Codex 70%+ / Claude 0%',         rarity: RARITY.RARE,      xp: 100, category: 'USAGE' },
  { id: 'fresh_start',      name: 'FRESH START',       desc: '리셋 1회 목격',                  rarity: RARITY.COMMON,    xp: 50,  category: 'USAGE' },
  { id: 'phoenix',          name: 'PHOENIX',           desc: '리셋 10회 누적',                 rarity: RARITY.RARE,      xp: 150, category: 'USAGE' },
  { id: 'eternal_cycle',    name: 'ETERNAL CYCLE',     desc: '리셋 100회 누적',                rarity: RARITY.LEGENDARY, xp: 500, category: 'USAGE' },

  // ── 성장 ──
  { id: 'level_10',         name: 'LEVEL 10',          desc: 'LV10 도달',                      rarity: RARITY.COMMON,    xp: 100, category: 'GROWTH' },
  { id: 'level_25',         name: 'LEVEL 25',          desc: 'LV25 도달',                      rarity: RARITY.RARE,      xp: 200, category: 'GROWTH' },
  { id: 'level_50',         name: 'LEVEL 50',          desc: 'LV50 도달',                      rarity: RARITY.EPIC,      xp: 400, category: 'GROWTH' },
  { id: 'reborn',           name: 'REBORN',            desc: '첫 환생',                        rarity: RARITY.LEGENDARY, xp: 500, category: 'GROWTH' },
  { id: 'skin_collector',   name: 'SKIN COLLECTOR',    desc: '스킨 6개 해금',                   rarity: RARITY.RARE,      xp: 100, category: 'GROWTH' },
  { id: 'fashionista',      name: 'FASHIONISTA',       desc: '스킨 12개 전부 해금',             rarity: RARITY.EPIC,      xp: 300, category: 'GROWTH' },

  // ── 인터랙션 ──
  { id: 'pet_the_cat',      name: 'PET THE CAT',       desc: '고양이 10회 클릭',               rarity: RARITY.COMMON,    xp: 50,  category: 'INTERACT' },
  { id: 'cat_whisperer',    name: 'CAT WHISPERER',     desc: '고양이 100회 클릭',              rarity: RARITY.RARE,      xp: 100, category: 'INTERACT' },
  { id: 'style_switch',     name: 'STYLE SWITCH',      desc: '스킨 20회 변경',                 rarity: RARITY.COMMON,    xp: 50,  category: 'INTERACT' },
  { id: 'drawer_explorer',  name: 'DRAWER EXPLORER',   desc: '드로어 50회 열기',               rarity: RARITY.COMMON,    xp: 50,  category: 'INTERACT' },

  // ── 시크릿 ──
  { id: 'not_found',        name: '404 CAT NOT FOUND',    desc: '???',                        rarity: RARITY.SECRET,    xp: 150, category: 'SECRET',  hidden: true },
  { id: 'perfectly_balanced', name: 'PERFECTLY BALANCED', desc: '???',                        rarity: RARITY.SECRET,    xp: 200, category: 'SECRET',  hidden: true },
  { id: 'midnight_coder',   name: 'MIDNIGHT CODER',    desc: '???',                           rarity: RARITY.SECRET,    xp: 200, category: 'SECRET',  hidden: true },
  { id: 'speed_demon',      name: 'SPEED DEMON',       desc: '???',                           rarity: RARITY.SECRET,    xp: 250, category: 'SECRET',  hidden: true },
  { id: 'the_collector',    name: 'THE COLLECTOR',     desc: '???',                           rarity: RARITY.SECRET,    xp: 500, category: 'SECRET',  hidden: true },
];

// ─── 스킨 해금표 ───────────────────────────────────────────

/**
 * 해금 레벨 기준.
 * unlockLevel: 0 = 시작 해금
 */
const SKIN_UNLOCKS = {
  robot:    { unlockLevel: 0,  order: 0 },
  grey:     { unlockLevel: 3,  order: 1 },
  orange:   { unlockLevel: 7,  order: 2 },
  calico:   { unlockLevel: 10, order: 3 },
  siamese:  { unlockLevel: 12, order: 4 },
  tuxedo:   { unlockLevel: 15, order: 5 },
  midnight: { unlockLevel: 17, order: 6 },
  neon:     { unlockLevel: 20, order: 7 },
  fire:     { unlockLevel: 25, order: 8 },
  pastel:   { unlockLevel: 28, order: 9 },
  gameboy:  { unlockLevel: 35, order: 10 },
  mono:     { unlockLevel: 40, order: 11 },
};

// ─── 칭호 해금표 ───────────────────────────────────────────

const TITLE_UNLOCKS = [
  { level: 10, title: 'APPRENTICE' },
  { level: 15, title: 'JOURNEYMAN' },
  { level: 20, title: 'ARTISAN' },
  { level: 25, title: 'EXPERT' },
  { level: 30, title: 'VETERAN' },
  { level: 35, title: 'ELITE' },
  { level: 40, title: 'GRANDMASTER' },
  { level: 45, title: 'LEGEND' },
  { level: 50, title: 'MASTER CODER' },
];

// ─── 미션 풀 ───────────────────────────────────────────────

/**
 * 미션 정의
 * family: 동일 family 내에서 하루에 1개만 배정
 * minLevel: 이 레벨 이상일 때만 풀에 포함
 */
const DAILY_MISSIONS = [
  { id: 'heartbeat_100',   name: 'STEADY PULSE',      desc: '하트비트 100회',         target: 100,  xp: 30,  family: 'heartbeat',  minLevel: 1,  counter: 'heartbeats' },
  { id: 'heartbeat_300',   name: 'ENDURANCE RUN',     desc: '하트비트 300회',         target: 300,  xp: 60,  family: 'heartbeat',  minLevel: 20, counter: 'heartbeats' },
  { id: 'pet_cat_5',       name: 'GOOD KITTY',        desc: '고양이 5회 쓰다듬기',    target: 5,    xp: 20,  family: 'pet',        minLevel: 1,  counter: 'petClicks' },
  { id: 'pet_cat_10',      name: 'BEST FRIEND',       desc: '고양이 10회 쓰다듬기',   target: 10,   xp: 30,  family: 'pet',        minLevel: 10, counter: 'petClicks' },
  { id: 'usage_detect_3',  name: 'BUSY DEV',          desc: '사용량 변화 감지 3회',    target: 3,    xp: 30,  family: 'usage',      minLevel: 1,  counter: 'usageDetects' },
  { id: 'usage_detect_10', name: 'CODING SPREE',      desc: '사용량 변화 감지 10회',   target: 10,   xp: 50,  family: 'usage',      minLevel: 15, counter: 'usageDetects' },
  { id: 'danger_once',     name: 'LIVING ON THE EDGE', desc: '위험구간(85%+) 진입',   target: 1,    xp: 40,  family: 'danger',     minLevel: 1,  counter: 'dangerEntries' },
  { id: 'dual_provider',   name: 'TWO TOOL TANGO',    desc: '양쪽 동시 활성',         target: 1,    xp: 35,  family: 'dual',       minLevel: 1,  counter: 'dualActives' },
  { id: 'skin_change_3',   name: 'FASHION SHOW',      desc: '스킨 3회 변경',          target: 3,    xp: 20,  family: 'skin',       minLevel: 5,  counter: 'skinChanges' },
  { id: 'drawer_open_5',   name: 'CURIOUS CAT',       desc: '드로어 5회 열기',        target: 5,    xp: 15,  family: 'drawer',     minLevel: 1,  counter: 'drawerOpens' },
  { id: 'early_refresh',   name: 'MORNING CHECK',     desc: '오전 8시 전 첫 fetch',   target: 1,    xp: 25,  family: 'time',       minLevel: 1,  counter: 'earlyRefresh' },
  { id: 'late_refresh',    name: 'LATE NIGHT OPS',    desc: '오후 10시 이후 fetch',   target: 1,    xp: 25,  family: 'time',       minLevel: 1,  counter: 'lateRefresh' },
  { id: 'reset_witness',   name: 'CYCLE COMPLETE',    desc: '리셋 1회 목격',          target: 1,    xp: 35,  family: 'reset',      minLevel: 1,  counter: 'resetWitness' },
];

const WEEKLY_MISSIONS = [
  { id: 'streak_5',          name: 'FIVE DAY STREAK',  desc: '5일 연속 접속',           target: 5,    xp: 100, family: 'streak',     minLevel: 1,  counter: 'streakDays' },
  { id: 'streak_7',          name: 'PERFECT WEEK',     desc: '7일 연속 접속',           target: 7,    xp: 200, family: 'streak',     minLevel: 10, counter: 'streakDays' },
  { id: 'total_xp_3000',     name: 'XP HUNTER',        desc: '이번 주 3,000 XP 획득',  target: 3000, xp: 100, family: 'xp',         minLevel: 1,  counter: 'weeklyXp' },
  { id: 'total_xp_7000',     name: 'XP CHAMPION',      desc: '이번 주 7,000 XP 획득',  target: 7000, xp: 200, family: 'xp',         minLevel: 15, counter: 'weeklyXp' },
  { id: 'danger_5',          name: 'THRILL SEEKER',    desc: '위험구간 5회 진입',       target: 5,    xp: 120, family: 'danger',      minLevel: 5,  counter: 'weeklyDanger' },
  { id: 'dual_10',           name: 'VERSATILE CODER',  desc: '양쪽 동시 활성 10회',     target: 10,   xp: 150, family: 'dual',        minLevel: 5,  counter: 'weeklyDual' },
  { id: 'total_heartbeats_2000', name: 'SERVER UPTIME', desc: '하트비트 2000회',        target: 2000, xp: 150, family: 'heartbeat',   minLevel: 10, counter: 'weeklyHeartbeats' },
];

/** 일일 미션 배정 수 */
const DAILY_MISSION_COUNT = 3;
/** 주간 미션 배정 수 */
const WEEKLY_MISSION_COUNT = 2;

// ─── 사운드 이벤트 ─────────────────────────────────────────

const SOUND_EVENTS = {
  UI_CLICK:      'click.ogg',
  LEVEL_UP:      'levelup.wav',
  ACHIEVEMENT:   'fanfare.ogg',
  MISSION_DONE:  'mission_done.wav',
  PET_CAT:       'click.ogg',
  REBIRTH:       'fanfare.ogg',
};

/** 기본 음량 (0.0 ~ 1.0) */
const DEFAULT_VOLUME = 0.3;

// ─── 기타 상수 ─────────────────────────────────────────────

/** 일일 히스토리 보관 일수 (무료) */
const HISTORY_DAYS_FREE = 90;
/** 주간 히스토리 보관 주수 */
const HISTORY_WEEKS = 52;

/** gamedata.json 스키마 버전 */
const GAMEDATA_VERSION = 1;

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  // XP & Level
  XP_BASE,
  XP_EXPONENT,
  LEVEL_CAP,
  MAX_REBIRTH,
  XP_REWARDS,
  STREAK_XP_PER_DAY,
  STREAK_XP_CAP,
  PET_XP_DAILY_CAP,
  USAGE_SPIKE_THRESHOLD,

  // Achievements
  RARITY,
  ACHIEVEMENTS,

  // Skins & Titles
  SKIN_UNLOCKS,
  TITLE_UNLOCKS,

  // Missions
  DAILY_MISSIONS,
  WEEKLY_MISSIONS,
  DAILY_MISSION_COUNT,
  WEEKLY_MISSION_COUNT,

  // Sound
  SOUND_EVENTS,
  DEFAULT_VOLUME,

  // Misc
  HISTORY_DAYS_FREE,
  HISTORY_WEEKS,
  GAMEDATA_VERSION,
};
