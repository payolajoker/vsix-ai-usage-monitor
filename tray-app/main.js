const { app, Notification, BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const gameStore = require('./game-store');
const gameEngine = require('./game-engine');

const HOME = os.homedir();
const REFRESH_MS = 60_000;
const WARN_THRESHOLD = 70;
const DANGER_THRESHOLD = 85;
const STALE_AFTER_MS = 3 * 60_000;
const ACTIVE_PROVIDER_HOLD_MS = 7 * 60_000;
const CODEX_APP_SERVER_TIMEOUT_MS = 7_000;
const PROVIDER_FETCH_TIMEOUT_MS = 15_000;
const SESSION_RATE_LIMIT_MAX_AGE_MS = 6 * 60 * 60_000;
const SESSION_SCAN_FILE_LIMIT = 20;
const CODEX_INIT_REQUEST_ID = 1;
const CODEX_RATE_LIMITS_REQUEST_ID = 2;
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const CLAUDE_OAUTH_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers';
const CLAUDE_OAUTH_CLIENT_ID =
  process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const APP_USER_MODEL_ID = 'AI USAGE';
const MINI_WIDTH = 560;
const MINI_HEIGHT = 238;
const MINI_HEIGHT_DETAILS = 500;
const INLINE_ROW_HEIGHT = 38;
const SNAP_THRESHOLD = 20;
const SNAP_MARGIN = 10;
const WINDOW_POSITION_SAVE_DEBOUNCE_MS = 180;
const TRAY_APP_VERSION = require('./package.json').version;

let miniWin = null;
let miniReady = false;
let miniVisible = true;
let pendingMiniPayload = null;
let refreshTimer = null;
let isQuitting = false;
let miniDetailsVisible = false;
let inlineExpandedCount = 0;
let focusMode = 'auto';
let activeProviderHint = { provider: 'neutral', until: 0 };
let previousPercents = { claude: null, codex: null };
let lastSuccessAt = 0;
let lastMiniMeta = makeDefaultMiniMeta();
let lastUsage = {
  claude: null,
  codex: null,
};
let lastLevels = {
  claude: 0,
  codex: 0,
};
let displayListenerCleanup = null;
let collapseTimer = null;
let moveSaveTimer = null;

app.setAppUserModelId(APP_USER_MODEL_ID);
app.on('window-all-closed', () => {});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (miniWin && !miniWin.isDestroyed()) {
      miniWin.showInactive();
      positionMiniWindow();
    }
  });

  app.whenReady().then(() => {
    gameStore.init(app.getPath('userData'));
    createMiniWindow();
    registerIpc();
    registerDisplayListeners();
    refreshNow();
    refreshTimer = setInterval(refreshNow, REFRESH_MS);
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  gameStore.saveSync();
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  if (moveSaveTimer) {
    clearTimeout(moveSaveTimer);
    moveSaveTimer = null;
  }
  if (displayListenerCleanup) {
    displayListenerCleanup();
    displayListenerCleanup = null;
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in tray app:', reason);
});

function createMiniWindow() {
  miniReady = false;
  pendingMiniPayload = null;
  inlineExpandedCount = 0;

  miniWin = new BrowserWindow({
    width: MINI_WIDTH,
    height: getMiniHeight(),
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#171024',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  miniWin.setMenuBarVisibility(false);
  miniWin.setAlwaysOnTop(true, 'screen-saver');

  miniWin.webContents.on('did-finish-load', () => {
    miniReady = true;
    const restored = restoreMiniWindowPosition();
    ensureMiniWindowGeometry();
    if (!restored) {
      positionMiniWindow();
    }
    if (miniVisible) {
      miniWin.showInactive();
    }
    if (pendingMiniPayload) {
      miniWin.webContents.send('usage-update', pendingMiniPayload);
      pendingMiniPayload = null;
    }
  });

  miniWin.webContents.on('render-process-gone', (_event, details) => {
    if (isQuitting) {
      return;
    }
    console.error('Mini window renderer crashed:', details);
    recreateMiniWindow();
  });
  miniWin.loadFile(path.join(__dirname, 'mini.html'));

  miniWin.on('moved', () => {
    if (!miniWin || miniWin.isDestroyed()) return;
    const bounds = miniWin.getBounds();
    const display = screen.getPrimaryDisplay();
    if (!display) return;
    const area = display.workArea;
    let { x, y } = bounds;
    let snapped = false;

    // Left edge snap
    if (Math.abs(x - area.x) < SNAP_THRESHOLD) {
      x = area.x + SNAP_MARGIN;
      snapped = true;
    }
    // Right edge snap
    else if (Math.abs((x + bounds.width) - (area.x + area.width)) < SNAP_THRESHOLD) {
      x = area.x + area.width - bounds.width - SNAP_MARGIN;
      snapped = true;
    }

    // Top edge snap
    if (Math.abs(y - area.y) < SNAP_THRESHOLD) {
      y = area.y + SNAP_MARGIN;
      snapped = true;
    }
    // Bottom edge snap
    else if (Math.abs((y + bounds.height) - (area.y + area.height)) < SNAP_THRESHOLD) {
      y = area.y + area.height - bounds.height - SNAP_MARGIN;
      snapped = true;
    }

    if (snapped) {
      miniWin.setPosition(Math.round(x), Math.round(y), false);
    }

    const finalX = snapped ? x : bounds.x;
    const finalY = snapped ? y : bounds.y;
    scheduleMiniWindowPositionSave(finalX, finalY);
  });

  miniWin.on('close', () => {
    app.quit();
  });

  miniWin.on('closed', () => {
    if (moveSaveTimer) {
      clearTimeout(moveSaveTimer);
      moveSaveTimer = null;
    }
    miniReady = false;
    miniWin = null;
  });
}

function recreateMiniWindow() {
  if (isQuitting) {
    return;
  }

  miniReady = false;

  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.destroy();
  }

  miniWin = null;
  createMiniWindow();

  if (lastUsage.claude || lastUsage.codex) {
    updateMiniWindow(lastUsage.claude, lastUsage.codex, lastMiniMeta);
  }
}

function registerIpc() {
  const applyDetailsVisibility = (nextVisible) => {
    setMiniDetailsVisible(Boolean(nextVisible));
    sendMiniDetailsState();
    return miniDetailsVisible;
  };

  ipcMain.on('mini-set-focus-mode', (_event, nextMode) => {
    applyFocusMode(nextMode);
  });

  ipcMain.handle('mini-toggle-details', (_event, nextVisible) => {
    return applyDetailsVisibility(nextVisible);
  });

  ipcMain.on('mini-toggle-details', (_event, nextVisible) => {
    applyDetailsVisibility(nextVisible);
  });

  // Game IPC
  ipcMain.handle('game-pet-click', () => {
    try {
      const game = gameStore.getData();
      if (!game) return null;
      const events = gameEngine.processPetClick(game);
      gameStore.markDirty();
      gameStore.save();
      return { events, summary: gameEngine.getGameSummary(game) };
    } catch (err) {
      console.error('[IPC] game-pet-click error:', err.message);
      return null;
    }
  });

  ipcMain.handle('game-interaction', (_event, type) => {
    try {
      const game = gameStore.getData();
      if (!game) return null;
      const events = gameEngine.processInteraction(game, type);
      gameStore.markDirty();
      gameStore.save();
      return { events, summary: gameEngine.getGameSummary(game) };
    } catch (err) {
      console.error('[IPC] game-interaction error:', err.message);
      return null;
    }
  });

  ipcMain.handle('game-set-skin', (_event, skinId) => {
    try {
      const game = gameStore.getData();
      if (!game) return null;
      if (game.unlockedSkins.includes(skinId)) {
        game.activeSkin = skinId;
        gameStore.markDirty();
        gameStore.save();
      }
      return gameEngine.getGameSummary(game);
    } catch (err) {
      console.error('[IPC] game-set-skin error:', err.message);
      return null;
    }
  });

  ipcMain.handle('game-set-sound', (_event, { enabled, volume }) => {
    try {
      const game = gameStore.getData();
      if (!game) return null;
      if (enabled !== undefined) game.soundEnabled = enabled;
      if (volume !== undefined) game.soundVolume = volume;
      gameStore.markDirty();
      gameStore.save();
      return { soundEnabled: game.soundEnabled, soundVolume: game.soundVolume };
    } catch (err) {
      console.error('[IPC] game-set-sound error:', err.message);
      return null;
    }
  });

  ipcMain.handle('game-rebirth', () => {
    try {
      const game = gameStore.getData();
      if (!game) return null;
      const result = gameEngine.doRebirth(game);
      if (result.success) {
        gameStore.markDirty();
        gameStore.save();
      }
      return { result, summary: gameEngine.getGameSummary(game) };
    } catch (err) {
      console.error('[IPC] game-rebirth error:', err.message);
      return null;
    }
  });

  ipcMain.handle('game-migrate-skin', (_event, skinId) => {
    try {
      gameStore.migrateLegacySkin(skinId);
      gameStore.save();
      return true;
    } catch (err) {
      console.error('[IPC] game-migrate-skin error:', err.message);
      return null;
    }
  });

  // Inline detail expand/collapse
  ipcMain.on('mini-inline-expand', (_event, expandedCount) => {
    const count = Math.max(0, Math.min(2, Number(expandedCount) || 0));
    if (count === inlineExpandedCount) return;
    const wasExpanding = count > inlineExpandedCount;
    inlineExpandedCount = count;

    if (wasExpanding) {
      ensureMiniWindowGeometry();
    } else {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
      collapseTimer = setTimeout(() => {
        collapseTimer = null;
        ensureMiniWindowGeometry();
      }, 240);
    }
  });
}

function registerDisplayListeners() {
  const reposition = () => {
    if (miniVisible && miniWin && !miniWin.isDestroyed()) {
      positionMiniWindow();
    }
  };
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);

  displayListenerCleanup = () => {
    screen.removeListener('display-metrics-changed', reposition);
    screen.removeListener('display-added', reposition);
    screen.removeListener('display-removed', reposition);
  };
}

function getMiniHeight() {
  const base = miniDetailsVisible ? MINI_HEIGHT_DETAILS : MINI_HEIGHT;
  return base + (inlineExpandedCount * INLINE_ROW_HEIGHT);
}

function setMiniDetailsVisible(nextVisible) {
  if (miniDetailsVisible === nextVisible) {
    sendMiniDetailsState();
    return;
  }

  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  miniDetailsVisible = nextVisible;
  sendMiniDetailsState();

  if (nextVisible) {
    // Expanding: resize window first so CSS has room to animate into
    ensureMiniWindowGeometry();
  } else {
    // Collapsing: let CSS transition (220ms) finish, then shrink window
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      ensureMiniWindowGeometry();
    }, 260);
  }

  if (lastUsage.claude || lastUsage.codex) {
    updateMiniWindow(lastUsage.claude, lastUsage.codex, lastMiniMeta);
  }
}

function clampToWorkArea(x, y, w, h) {
  const display = screen.getPrimaryDisplay();
  if (!display) return { x, y };
  const area = display.workArea;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - w)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - h)),
  };
}

function ensureMiniWindowGeometry() {
  if (!miniWin || miniWin.isDestroyed()) {
    return;
  }
  if (collapseTimer) {
    return; // Collapse animation in progress; defer resize
  }

  const bounds = miniWin.getBounds();
  const targetHeight = getMiniHeight();
  const display = screen.getPrimaryDisplay();
  if (!display) return;
  const area = display.workArea;

  if (bounds.width !== MINI_WIDTH || bounds.height !== targetHeight) {
    const isTopAnchored = (bounds.y - area.y) <= SNAP_THRESHOLD;

    let newY;
    if (isTopAnchored) {
      newY = bounds.y; // Top anchor: y fixed, expand downward
    } else {
      newY = bounds.y + bounds.height - targetHeight; // Bottom anchor: bottom fixed, expand upward
    }

    const clamped = clampToWorkArea(bounds.x, newY, MINI_WIDTH, targetHeight);
    miniWin.setBounds(
      {
        x: clamped.x,
        y: clamped.y,
        width: MINI_WIDTH,
        height: targetHeight,
      },
      false
    );
  }

  if (miniWin.webContents && !miniWin.webContents.isDestroyed()) {
    miniWin.webContents.invalidate();
  }
}

function scheduleMiniWindowPositionSave(x, y) {
  if (moveSaveTimer) {
    clearTimeout(moveSaveTimer);
  }
  moveSaveTimer = setTimeout(() => {
    moveSaveTimer = null;
    const game = gameStore.getData();
    if (!game) return;
    game.windowPosition = {
      x: Math.round(x),
      y: Math.round(y),
    };
    gameStore.markDirty();
    gameStore.save();
  }, WINDOW_POSITION_SAVE_DEBOUNCE_MS);
}

function restoreMiniWindowPosition() {
  if (!miniWin || miniWin.isDestroyed()) return false;
  const game = gameStore.getData();
  const saved = game && game.windowPosition;
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    return false;
  }
  const display = screen.getPrimaryDisplay();
  if (!display) return false;
  const area = display.workArea;
  const targetHeight = getMiniHeight();
  if (saved.x < area.x || saved.x > area.x + area.width - MINI_WIDTH) {
    return false;
  }
  if (saved.y < area.y || saved.y > area.y + area.height - targetHeight) {
    return false;
  }
  miniWin.setPosition(Math.round(saved.x), Math.round(saved.y), false);
  return true;
}

function sendMiniDetailsState() {
  if (!miniWin || miniWin.isDestroyed()) {
    return;
  }
  if (!miniWin.webContents || miniWin.webContents.isDestroyed()) {
    return;
  }
  try {
    miniWin.webContents.send('mini-details-state', miniDetailsVisible);
  } catch {
    // Window may be closing
  }
}

function positionMiniWindow() {
  if (!miniWin || miniWin.isDestroyed()) {
    return;
  }

  try {
    const display = screen.getPrimaryDisplay();
    if (!display) return;
    const area = display.workArea;
    const bounds = miniWin.getBounds();
    const currentHeight = bounds && bounds.height ? bounds.height : getMiniHeight();
    const x = Math.round(area.x + area.width - MINI_WIDTH - 10);
    const y = Math.round(area.y + area.height - currentHeight - 10);
    miniWin.setPosition(x, y, false);
  } catch {
    // Window was destroyed between check and setPosition
  }
}

function applyFocusMode(nextMode) {
  if (!['auto', 'claude', 'codex'].includes(nextMode)) {
    return;
  }

  focusMode = nextMode;
  if (focusMode === 'auto') {
    activeProviderHint.until = 0;
    activeProviderHint.provider = 'neutral';
  } else {
    activeProviderHint = {
      provider: focusMode,
      until: Date.now() + ACTIVE_PROVIDER_HOLD_MS,
    };
  }

  if (lastUsage.claude || lastUsage.codex) {
    lastMiniMeta = buildMiniMeta(lastUsage.claude, lastUsage.codex, { updateHistory: false });
    updateMiniWindow(lastUsage.claude, lastUsage.codex, lastMiniMeta);
  }
}

async function refreshNow() {
  if (isQuitting) {
    return;
  }

  const [claudeResult, codexResult] = await Promise.allSettled([
    withTimeout(getClaudeUsage(), PROVIDER_FETCH_TIMEOUT_MS, 'Claude usage request timed out'),
    withTimeout(getCodexUsage(), PROVIDER_FETCH_TIMEOUT_MS, 'Codex usage request timed out'),
  ]);
  const claude = usageFromSettledResult('claude', claudeResult);
  const codex = usageFromSettledResult('codex', codexResult);

  try {
    lastMiniMeta = buildMiniMeta(claude, codex, { updateHistory: true });
    lastUsage = { claude, codex };

    try {
      // Game loop failures should not block usage rendering.
      gameStore.checkRollover();
      const game = gameStore.getData();
      if (game) {
        const c5 = getUsagePercent(claude, 'ratio');
        const o5 = getUsagePercent(codex, 'percent');
        const prevC5 = previousPercents.claude;
        const prevO5 = previousPercents.codex;
        const resetDetected =
          (prevC5 != null && prevC5 >= 50 && c5 != null && c5 < 10) ||
          (prevO5 != null && prevO5 >= 50 && o5 != null && o5 < 10);

        const gameEvents = gameEngine.processRefresh(game, {
          claude5h: c5 || 0,
          codex5h: o5 || 0,
          claudeTrend: lastMiniMeta.trend.claude,
          codexTrend: lastMiniMeta.trend.codex,
          claudeError: Boolean(claude && claude.error),
          codexError: Boolean(codex && codex.error),
          state: lastMiniMeta.state,
          timestamp: Date.now(),
          resetDetected,
        });

        gameStore.markDirty();
        gameStore.save();
        lastMiniMeta._gameEvents = gameEvents;
      }
    } catch (gameErr) {
      console.error('[refreshNow/game]', gameErr.message || gameErr);
    }

    updateMiniWindow(claude, codex, lastMiniMeta);
    maybeNotify('Claude', claude, 'ratio');
    maybeNotify('Codex', codex, 'percent');
  } catch (err) {
    console.error('[refreshNow]', err.message || err);
  }
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function usageErrorPayload(provider, error) {
  return {
    fiveHour: null,
    sevenDay: null,
    error: formatUsageErrorDetail(provider, String((error && error.message) || error || 'Unknown error')),
    source: 'error',
  };
}

function usageFromSettledResult(provider, settled) {
  if (settled && settled.status === 'fulfilled') {
    const usage = settled.value;
    if (usage && typeof usage === 'object' && Object.prototype.hasOwnProperty.call(usage, 'fiveHour')) {
      return usage;
    }
    return usageErrorPayload(provider, 'Invalid usage payload');
  }
  return usageErrorPayload(provider, settled ? settled.reason : 'Unknown error');
}

function updateMiniWindow(claude, codex, meta = makeDefaultMiniMeta()) {
  if (!miniWin || miniWin.isDestroyed()) {
    return;
  }

  ensureMiniWindowGeometry();

  const game = gameStore.getData();
  const gameSummary = game ? gameEngine.getGameSummary(game) : null;

  const payload = {
    claude: toMiniPayload('claude', claude, 'ratio', meta.trend.claude, meta.changed.claude, meta.crossings.claude),
    codex: toMiniPayload('codex', codex, 'percent', meta.trend.codex, meta.changed.codex, meta.crossings.codex),
    updatedAt: new Date().toLocaleTimeString(),
    focusMode: meta.focusMode,
    activeProvider: meta.activeProvider,
    state: meta.state,
    stale: meta.stale,
    detailsVisible: miniDetailsVisible,
    game: gameSummary,
    gameEvents: meta._gameEvents || null,
  };

  if (!miniReady) {
    pendingMiniPayload = payload;
    return;
  }

  try {
    miniWin.webContents.send('usage-update', payload);
  } catch {
    // Window destroyed between ready check and send
  }
}

function toMiniPayload(provider, usage, scale, trend = 0, changed = false, crossings = { warn: false, danger: false }) {
  if (usage.error || !usage.fiveHour) {
    return {
      used5h: null,
      used7d: null,
      reset5h: '',
      reset7d: '',
      error: formatUsageErrorDetail(provider, usage.error || 'No data'),
      level: 0,
      progress: 0,
      trend: 0,
      changed: false,
      warnCrossed: false,
      dangerCrossed: false,
      source: usage.source || '',
    };
  }

  const used5h = toPercent(usage.fiveHour.utilization, scale);
  const used7d = usage.sevenDay ? toPercent(usage.sevenDay.utilization, scale) : null;
  const reset5h = formatReset(usage.fiveHour.resetsAt, '5h');
  const reset7d = usage.sevenDay ? formatReset(usage.sevenDay.resetsAt, '7d') : '';
  const level = used5h >= DANGER_THRESHOLD ? 2 : used5h >= WARN_THRESHOLD ? 1 : 0;

  return {
    used5h,
    used7d,
    reset5h,
    reset7d,
    error: '',
    level,
    progress: Math.max(0, Math.min(100, used5h)),
    trend,
    changed,
    warnCrossed: Boolean(crossings.warn),
    dangerCrossed: Boolean(crossings.danger),
    source: usage.source || '',
  };
}

function makeDefaultMiniMeta() {
  return {
    focusMode,
    activeProvider: 'neutral',
    state: 'CALM',
    stale: true,
    trend: { claude: 0, codex: 0 },
    changed: { claude: false, codex: false },
    crossings: {
      claude: { warn: false, danger: false },
      codex: { warn: false, danger: false },
    },
  };
}

function getUsagePercent(usage, scale) {
  if (!usage || usage.error || !usage.fiveHour) {
    return null;
  }
  return toPercent(usage.fiveHour.utilization, scale);
}

function inferActiveProvider(current, trend, now) {
  if (focusMode !== 'auto') {
    return focusMode;
  }

  const claudeReady = current.claude != null;
  const codexReady = current.codex != null;

  if (activeProviderHint.until > now && activeProviderHint.provider !== 'neutral') {
    if ((activeProviderHint.provider === 'claude' && claudeReady) || (activeProviderHint.provider === 'codex' && codexReady)) {
      return activeProviderHint.provider;
    }
  }

  const claudeTrend = trend.claude;
  const codexTrend = trend.codex;
  let pick = 'neutral';

  if (claudeReady && codexReady) {
    if (claudeTrend > codexTrend) {
      pick = 'claude';
    } else if (codexTrend > claudeTrend) {
      pick = 'codex';
    } else {
      pick = current.claude >= current.codex ? 'claude' : 'codex';
    }
  } else if (claudeReady) {
    pick = 'claude';
  } else if (codexReady) {
    pick = 'codex';
  }

  if (pick !== 'neutral') {
    activeProviderHint = {
      provider: pick,
      until: now + ACTIVE_PROVIDER_HOLD_MS,
    };
  }

  return pick;
}

function buildMiniMeta(claude, codex, options = { updateHistory: true }) {
  const now = Date.now();
  const current = {
    claude: getUsagePercent(claude, 'ratio'),
    codex: getUsagePercent(codex, 'percent'),
  };

  const trend = {
    claude: current.claude != null && previousPercents.claude != null ? current.claude - previousPercents.claude : 0,
    codex: current.codex != null && previousPercents.codex != null ? current.codex - previousPercents.codex : 0,
  };

  const changed = {
    claude: Math.abs(trend.claude) >= 1,
    codex: Math.abs(trend.codex) >= 1,
  };

  const crossings = {
    claude: {
      warn: current.claude != null && previousPercents.claude != null && previousPercents.claude < WARN_THRESHOLD && current.claude >= WARN_THRESHOLD,
      danger: current.claude != null && previousPercents.claude != null && previousPercents.claude < DANGER_THRESHOLD && current.claude >= DANGER_THRESHOLD,
    },
    codex: {
      warn: current.codex != null && previousPercents.codex != null && previousPercents.codex < WARN_THRESHOLD && current.codex >= WARN_THRESHOLD,
      danger: current.codex != null && previousPercents.codex != null && previousPercents.codex < DANGER_THRESHOLD && current.codex >= DANGER_THRESHOLD,
    },
  };

  const levelClaude = current.claude == null ? 0 : current.claude >= DANGER_THRESHOLD ? 2 : current.claude >= WARN_THRESHOLD ? 1 : 0;
  const levelCodex = current.codex == null ? 0 : current.codex >= DANGER_THRESHOLD ? 2 : current.codex >= WARN_THRESHOLD ? 1 : 0;
  const hasError = Boolean((claude && claude.error) || (codex && codex.error));

  if (!hasError && current.claude != null && current.codex != null) {
    lastSuccessAt = now;
  }

  const stale = !lastSuccessAt || now - lastSuccessAt >= STALE_AFTER_MS;
  const activeProvider = inferActiveProvider(current, trend, now);

  let state = 'CALM';
  if (hasError) {
    state = 'ERROR';
  } else if (stale) {
    state = 'STALE';
  } else if (Math.max(levelClaude, levelCodex) >= 2) {
    state = 'HIGH';
  } else if (changed.claude || changed.codex) {
    state = 'USING';
  }

  if (options.updateHistory) {
    previousPercents = {
      claude: current.claude,
      codex: current.codex,
    };
  }

  return {
    focusMode,
    activeProvider,
    state,
    stale,
    trend,
    changed,
    crossings,
  };
}

function maybeNotify(name, usage, scale) {
  const key = name.toLowerCase();
  if (usage.error || !usage.fiveHour) {
    return;
  }

  const used = toPercent(usage.fiveHour.utilization, scale);
  const level = used >= DANGER_THRESHOLD ? 2 : used >= WARN_THRESHOLD ? 1 : 0;
  const previous = lastLevels[key] || 0;

  if (level > previous) {
    const stage = level === 2 ? 'Critical' : 'Warning';
    new Notification({
      title: 'AI USAGE',
      body: `${name} ${stage}: ${used}% used in 5-hour window.`,
    }).show();
  }

  lastLevels[key] = level;
}

function toPercent(utilization, scale) {
  const raw = scale === 'ratio' && utilization <= 1 ? utilization * 100 : utilization;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function formatReset(iso, windowType = '5h') {
  if (!iso) {
    return '';
  }
  try {
    const diff = Math.max(0, new Date(iso).getTime() - Date.now());
    const d = Math.floor(diff / 86_400_000);
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (windowType === '7d' && d > 0) {
      const remHours = Math.floor((diff % 86_400_000) / 3_600_000);
      return `${d}d ${remHours}h`;
    }
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    if (m > 0) {
      return `${m}m`;
    }
    return 'soon';
  } catch {
    return '';
  }
}

async function getClaudeUsage() {
  const credPath = path.join(HOME, '.claude', '.credentials.json');
  try {
    const cred = readClaudeCredentials(credPath);
    const token = cred.claudeAiOauth && cred.claudeAiOauth.accessToken;
    if (!token) {
      throw new Error('Missing Claude access token in credentials');
    }

    try {
      const data = await fetchClaudeUsage(token);
      return mapClaudeUsage(data);
    } catch (usageError) {
      if (!isClaudeTokenExpiredError(usageError)) {
        throw usageError;
      }

      const refreshed = await refreshClaudeAccessToken(credPath, cred);
      if (!refreshed.accessToken) {
        throw new Error('Claude token refresh did not return access token');
      }

      const retried = await fetchClaudeUsage(refreshed.accessToken);
      return mapClaudeUsage(retried);
    }
  } catch (error) {
    return {
      fiveHour: null,
      sevenDay: null,
      error: formatUsageErrorDetail('claude', formatHttpError(error)),
    };
  }
}

function readClaudeCredentials(credPath) {
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  if (!cred || !cred.claudeAiOauth) {
    throw new Error('Missing claudeAiOauth in credentials');
  }
  return cred;
}

function mapClaudeUsage(data) {
  return {
    fiveHour: data.five_hour
      ? { utilization: data.five_hour.utilization || 0, resetsAt: data.five_hour.resets_at || '' }
      : null,
    sevenDay: data.seven_day
      ? { utilization: data.seven_day.utilization || 0, resetsAt: data.seven_day.resets_at || '' }
      : null,
  };
}

function fetchClaudeUsage(token) {
  return httpsGet('api.anthropic.com', '/api/oauth/usage', {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': CLAUDE_OAUTH_BETA,
  });
}

function isClaudeTokenExpiredError(error) {
  const text = String((error && error.message) || error || '').toLowerCase();
  if (text.includes('token_expired') || text.includes('token has expired')) {
    return true;
  }

  if (error instanceof HttpStatusError) {
    if (error.statusCode !== 401) {
      return false;
    }
    const bodyText = (error.responseBody || '').toLowerCase();
    return bodyText.includes('token_expired') || bodyText.includes('token has expired');
  }

  return false;
}

async function refreshClaudeAccessToken(credPath, cred) {
  const oauth = cred.claudeAiOauth || {};
  const refreshToken = oauth.refreshToken;
  if (!refreshToken) {
    throw new Error('Claude refresh token missing. Run `claude setup-token`.');
  }

  const refreshed = await httpsPost('api.anthropic.com', '/v1/oauth/token', {}, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    scope: CLAUDE_OAUTH_SCOPE,
  });

  const accessToken = refreshed && refreshed.access_token;
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('Claude refresh response missing access_token');
  }

  const expiresIn = Number((refreshed && refreshed.expires_in) || 0);
  const nextOauth = {
    ...oauth,
    accessToken,
    refreshToken:
      refreshed && typeof refreshed.refresh_token === 'string' && refreshed.refresh_token
        ? refreshed.refresh_token
        : refreshToken,
    expiresAt: Date.now() + Math.max(0, expiresIn) * 1000,
  };

  if (refreshed && typeof refreshed.scope === 'string' && refreshed.scope.trim()) {
    nextOauth.scopes = refreshed.scope.trim().split(/\s+/);
  }

  cred.claudeAiOauth = nextOauth;
  const tmpPath = `${credPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(cred, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, credPath);
  return nextOauth;
}

async function getCodexUsage() {
  const appServerUsage = await getCodexUsageFromAppServer();
  if (!appServerUsage.error) {
    return appServerUsage;
  }

  const sessionUsage = await getCodexUsageFromSessions();
  if (!sessionUsage.error) {
    return sessionUsage;
  }

  return {
    fiveHour: null,
    sevenDay: null,
    error: formatUsageErrorDetail(
      'codex',
      `app_server=${appServerUsage.error || ''}; sessions=${sessionUsage.error || ''}`
    ),
    source: 'none',
  };
}

async function getCodexUsageFromAppServer() {
  try {
    const result = await readCodexRateLimitsFromAppServer();
    const snapshot = pickCodexSnapshot(result);
    if (!snapshot || !snapshot.primary) {
      return { fiveHour: null, sevenDay: null, error: 'No primary rate limit window from app server' };
    }

    return {
      fiveHour: mapCodexWindow(snapshot.primary),
      sevenDay: snapshot.secondary ? mapCodexWindow(snapshot.secondary) : null,
      source: 'app-server',
    };
  } catch (error) {
    return { fiveHour: null, sevenDay: null, error: String(error.message || error), source: 'app-server' };
  }
}

function killChildProcess(child) {
  try {
    if (child.killed) {
      return;
    }
    child.kill();
  } catch {
    // ignore
  }

  if (process.platform === 'win32' && child.pid) {
    const pid = child.pid;
    setTimeout(() => {
      try {
        process.kill(pid, 0);
        spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        // process already dead
      }
    }, 500);
  }
}

function readCodexRateLimitsFromAppServer() {
  return new Promise((resolve, reject) => {
    const child = spawnCodexAppServerProcess();
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timer = null;

    const doneResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        child.stdin.end();
      } catch {}
      killChildProcess(child);
      resolve(value);
    };

    const doneReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      try {
        child.stdin.end();
      } catch {}
      killChildProcess(child);
      reject(error);
    };

    child.on('error', (err) => {
      doneReject(new Error(`Failed to start codex app-server: ${err.message}`));
    });

    child.stdin.on('error', () => {
      // ignore EPIPE when app-server exits while writing
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 4000) {
        stderrBuffer = stderrBuffer.slice(-4000);
      }
    });

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let msg = null;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (!msg || typeof msg !== 'object') {
          continue;
        }

        if (msg.id !== CODEX_RATE_LIMITS_REQUEST_ID) {
          continue;
        }

        if (msg.error) {
          doneReject(new Error(`account/rateLimits/read failed: ${msg.error.message || 'Unknown error'}`));
          return;
        }

        doneResolve(msg.result || {});
        return;
      }
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      const detail = stderrBuffer.trim() ? ` stderr: ${stderrBuffer.trim()}` : '';
      doneReject(new Error(`codex app-server exited before response (code=${code}, signal=${signal}).${detail}`));
    });

    timer = setTimeout(() => {
      doneReject(new Error('codex app-server request timed out'));
    }, CODEX_APP_SERVER_TIMEOUT_MS);

    sendJson(child, {
      jsonrpc: '2.0',
      id: CODEX_INIT_REQUEST_ID,
      method: 'initialize',
      params: {
        clientInfo: { name: 'ai-usage-tray', version: TRAY_APP_VERSION },
        capabilities: { experimentalApi: true },
      },
    });
    sendJson(child, { jsonrpc: '2.0', method: 'initialized', params: {} });
    sendJson(child, {
      jsonrpc: '2.0',
      id: CODEX_RATE_LIMITS_REQUEST_ID,
      method: 'account/rateLimits/read',
      params: null,
    });
  });
}

function sendJson(child, payload) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function buildCodexSpawnEnv() {
  const env = { ...process.env };
  if (process.platform !== 'win32') {
    return env;
  }

  const appData = env.APPDATA || '';
  if (!appData) {
    return env;
  }

  const npmBin = path.join(appData, 'npm');
  const currentPath = String(env.Path || env.PATH || '');
  const segments = currentPath.split(';').filter(Boolean);
  const hasNpmBin = segments.some((segment) => segment.toLowerCase() === npmBin.toLowerCase());
  if (!hasNpmBin) {
    segments.unshift(npmBin);
  }

  const mergedPath = segments.join(';');
  env.Path = mergedPath;
  env.PATH = mergedPath;
  return env;
}

function resolveCodexCommandWindows() {
  const candidates = [];
  const pushUnique = (candidate) => {
    if (!candidate) {
      return;
    }
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  pushUnique(process.env.CODEX_CLI_PATH);
  if (process.env.APPDATA) {
    pushUnique(path.join(process.env.APPDATA, 'npm', 'codex.cmd'));
    pushUnique(path.join(process.env.APPDATA, 'npm', 'codex.exe'));
  }
  if (HOME) {
    pushUnique(path.join(HOME, 'AppData', 'Roaming', 'npm', 'codex.cmd'));
    pushUnique(path.join(HOME, 'AppData', 'Roaming', 'npm', 'codex.exe'));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore inaccessible paths
    }
  }

  return 'codex';
}

function spawnCodexAppServerProcess() {
  const env = buildCodexSpawnEnv();
  if (process.platform === 'win32') {
    const codexCommand = resolveCodexCommandWindows();
    return spawn(codexCommand, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
      shell: true,
    });
  }
  return spawn('codex', ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env,
  });
}

function pickCodexSnapshot(result) {
  const byLimitId = result && result.rateLimitsByLimitId;
  if (byLimitId && typeof byLimitId === 'object') {
    if (byLimitId.codex) {
      return byLimitId.codex;
    }

    for (const [key, value] of Object.entries(byLimitId)) {
      if (key.toLowerCase().includes('codex')) {
        return value;
      }
      const label = `${value.limitId || ''} ${value.limitName || ''}`.toLowerCase();
      if (label.includes('codex')) {
        return value;
      }
    }

    const first = Object.values(byLimitId)[0];
    if (first) {
      return first;
    }
  }

  return result ? result.rateLimits || null : null;
}

function mapCodexWindow(window) {
  const usedRaw = window ? window.usedPercent ?? window.used_percent ?? 0 : 0;
  const resetsRaw = window ? window.resetsAt ?? window.resets_at ?? null : null;
  const usedPercent = Number(usedRaw);
  return {
    utilization: Number.isFinite(usedPercent) ? usedPercent : 0,
    resetsAt: unixToIso(resetsRaw),
  };
}

function unixToIso(ts) {
  if (!ts) {
    return '';
  }
  const numericTs = Number(ts);
  if (!Number.isFinite(numericTs)) {
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }
  const ms = numericTs > 9_999_999_999 ? numericTs : numericTs * 1000;
  return new Date(ms).toISOString();
}

async function getCodexUsageFromSessions() {
  try {
    const sessionsDir = path.join(HOME, '.codex', 'sessions');
    const files = findJsonlFiles(sessionsDir);
    if (files.length === 0) {
      return { fiveHour: null, sevenDay: null, error: 'No session files found', source: 'sessions' };
    }

    const withMtime = files.map((f) => {
      try {
        return { path: f, mtime: fs.statSync(f).mtimeMs };
      } catch {
        return { path: f, mtime: 0 };
      }
    });
    withMtime.sort((a, b) => b.mtime - a.mtime);

    let latest = null;
    for (const file of withMtime.slice(0, SESSION_SCAN_FILE_LIMIT).map((e) => e.path)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) {
          continue;
        }
        try {
          const data = JSON.parse(line);
          if (data.type === 'event_msg' && data.payload && data.payload.type === 'token_count' && data.payload.rate_limits) {
            const rateLimits = data.payload.rate_limits;
            const limitId = String((rateLimits.limit_id || rateLimits.limitId || '')).toLowerCase();
            const eventMs = Date.parse(String(data.timestamp || ''));
            if (!Number.isFinite(eventMs)) {
              continue;
            }

            if (
              !latest ||
              eventMs > latest.eventMs ||
              (eventMs === latest.eventMs && limitId === 'codex' && latest.limitId !== 'codex')
            ) {
              latest = { rateLimits, limitId, eventMs };
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    if (!latest || !latest.rateLimits) {
      return { fiveHour: null, sevenDay: null, error: 'No rate limits data', source: 'sessions' };
    }
    if (Date.now() - latest.eventMs > SESSION_RATE_LIMIT_MAX_AGE_MS) {
      return { fiveHour: null, sevenDay: null, error: 'No recent rate limits data', source: 'sessions' };
    }
    if (latest.limitId !== 'codex') {
      return { fiveHour: null, sevenDay: null, error: 'No codex primary limit in session data', source: 'sessions' };
    }

    const primary = latest.rateLimits.primary || {};
    const secondary = latest.rateLimits.secondary || {};
    const primaryUsed = Number(primary.used_percent ?? primary.usedPercent ?? 0);
    const secondaryUsed = Number(secondary.used_percent ?? secondary.usedPercent ?? 0);

    return {
      fiveHour: {
        utilization: Number.isFinite(primaryUsed) ? primaryUsed : 0,
        resetsAt: unixToIso(primary.resets_at ?? primary.resetsAt),
      },
      sevenDay: {
        utilization: Number.isFinite(secondaryUsed) ? secondaryUsed : 0,
        resetsAt: unixToIso(secondary.resets_at ?? secondary.resetsAt),
      },
      source: 'sessions',
    };
  } catch (error) {
    return { fiveHour: null, sevenDay: null, error: String(error.message || error), source: 'sessions' };
  }
}

function findJsonlFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  const walk = (currentDir) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(full);
      }
    }
  };

  walk(dir);
  return results;
}

class HttpStatusError extends Error {
  constructor(statusCode, message, responseBody) {
    super(message);
    this.name = 'HttpStatusError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function formatHttpError(error) {
  if (error instanceof HttpStatusError) {
    return error.message;
  }
  return String((error && error.message) || error);
}

function formatUsageErrorDetail(provider, errorText) {
  const text = String(errorText || '').toLowerCase();
  if (provider === 'claude') {
    if (
      text.includes('token_expired') ||
      text.includes('token has expired') ||
      text.includes('invalid_grant')
    ) {
      return 'CLAUDE CLI RELOGIN REQUIRED (run: claude setup-token)';
    }
    if (
      text.includes('refresh token missing') ||
      text.includes('missing claudeaioauth') ||
      text.includes('missing claude access token') ||
      text.includes('.credentials.json') ||
      (text.includes('enoent') && text.includes('no such file'))
    ) {
      return 'CLAUDE CLI LOGIN REQUIRED (run: claude setup-token)';
    }
    if (text.includes('timed out') || text.includes('timeout')) {
      return 'CLAUDE API TIMEOUT';
    }
    return 'CLAUDE USAGE UNAVAILABLE';
  }

  if (
    text.includes('authentication') ||
    text.includes('unauthorized') ||
    text.includes('401') ||
    text.includes('login required') ||
    text.includes('not logged in')
  ) {
    return 'CODEX CLI LOGIN REQUIRED (run: codex login)';
  }
  if (
    text.includes('failed to start codex app-server') &&
    (text.includes('enoent') || text.includes('not recognized') || text.includes('cannot find'))
  ) {
    return 'CODEX CLI NOT FOUND (check codex install)';
  }
  if (text.includes('no session files found') || text.includes('no rate limits data')) {
    return 'CODEX CLI DATA MISSING (run: codex once)';
  }
  if (text.includes('no recent rate limits data')) {
    return 'CODEX CLI DATA STALE (run: codex once)';
  }
  if (text.includes('no codex primary limit in session data')) {
    return 'CODEX RATE LIMIT UNKNOWN';
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return 'CODEX CLI TIMEOUT';
  }
  if (text.includes('app-server') || text.includes('app_server=')) {
    return 'CODEX APP-SERVER UNAVAILABLE';
  }
  return 'CODEX USAGE UNAVAILABLE';
}

function httpsGet(hostname, urlPath, headers) {
  return httpsJsonRequest('GET', hostname, urlPath, headers);
}

function httpsPost(hostname, urlPath, headers, body) {
  return httpsJsonRequest('POST', hostname, urlPath, headers, body);
}

function httpsJsonRequest(method, hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    let payload = '';
    const reqHeaders = { ...headers };
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = https.request({ hostname, path: urlPath, method, headers: reqHeaders }, (res) => {
      let raw = '';
      res.on('error', (err) => reject(err));
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const status = res.statusCode || 0;
          let message = `HTTP ${status}`;
          try {
            const errBody = JSON.parse(raw);
            if (errBody && errBody.error && errBody.error.message) {
              message = `HTTP ${status}: ${errBody.error.message}`;
            } else if (raw) {
              message = `HTTP ${status}: ${raw}`;
            }
          } catch {
            if (raw) {
              message = `HTTP ${status}: ${raw}`;
            }
          }
          reject(new HttpStatusError(status, message, raw));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8_000, () => {
      req.destroy(new Error('Request timed out'));
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

