const { app, Notification, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const gameStore = require('./game-store');
const gameEngine = require('./game-engine');
const {
  getClaudeUsage,
  getCodexUsage,
  formatUsageErrorDetail,
} = require('./provider-adapter');

const REFRESH_MS = 60_000;
const WARN_THRESHOLD = 70;
const DANGER_THRESHOLD = 85;
const STALE_AFTER_MS = 3 * 60_000;
const ACTIVE_PROVIDER_HOLD_MS = 7 * 60_000;
const PROVIDER_FETCH_TIMEOUT_MS = 15_000;
const APP_USER_MODEL_ID = 'AI USAGE';
const MINI_WIDTH = 560;
const MINI_HEIGHT = 238;
const MINI_HEIGHT_DETAILS = 500;
const INLINE_ROW_HEIGHT = 56;
const SNAP_THRESHOLD = 20;
const SNAP_MARGIN = 10;
const WINDOW_POSITION_SAVE_DEBOUNCE_MS = 180;

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
    const area = getWorkAreaForBounds(bounds);
    if (!area) return;
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
  const area = getWorkAreaForPoint(x, y);
  if (!area) return { x, y };
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - w)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - h)),
  };
}

function getWorkAreaForBounds(bounds) {
  if (!bounds) {
    const fallback = screen.getPrimaryDisplay();
    return fallback ? fallback.workArea : null;
  }

  const probe = {
    x: Math.round(bounds.x || 0),
    y: Math.round(bounds.y || 0),
    width: Math.max(1, Math.round(bounds.width || MINI_WIDTH)),
    height: Math.max(1, Math.round(bounds.height || getMiniHeight())),
  };

  const matched = screen.getDisplayMatching(probe);
  if (matched && matched.workArea) {
    return matched.workArea;
  }

  const nearest = screen.getDisplayNearestPoint({ x: probe.x, y: probe.y });
  if (nearest && nearest.workArea) {
    return nearest.workArea;
  }

  const fallback = screen.getPrimaryDisplay();
  return fallback ? fallback.workArea : null;
}

function getWorkAreaForPoint(x, y) {
  const all = screen.getAllDisplays();
  const hit = all.find((display) => {
    const area = display.workArea;
    return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
  });
  if (hit && hit.workArea) {
    return hit.workArea;
  }

  const nearest = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  if (nearest && nearest.workArea) {
    return nearest.workArea;
  }

  const fallback = screen.getPrimaryDisplay();
  return fallback ? fallback.workArea : null;
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
  const area = getWorkAreaForBounds(bounds);
  if (!area) return;

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
  const area = getWorkAreaForPoint(saved.x, saved.y);
  if (!area) return false;
  const targetHeight = getMiniHeight();
  const clamped = {
    x: Math.max(area.x, Math.min(saved.x, area.x + area.width - MINI_WIDTH)),
    y: Math.max(area.y, Math.min(saved.y, area.y + area.height - targetHeight)),
  };
  miniWin.setPosition(Math.round(clamped.x), Math.round(clamped.y), false);
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
    const bounds = miniWin.getBounds();
    const area = getWorkAreaForBounds(bounds);
    if (!area) return;
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
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toLocaleTimeString() : '',
    focusMode: meta.focusMode,
    activeProvider: meta.activeProvider,
    state: meta.state,
    stale: meta.stale,
    staleReason: meta.staleReason || '',
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
    staleReason: 'NO_SUCCESS_YET',
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
  const staleReason = hasError
    ? 'PROVIDER_ERROR'
    : !lastSuccessAt
      ? 'NO_SUCCESS_YET'
      : stale
        ? 'LAST_SUCCESS_EXPIRED'
        : '';

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
    staleReason,
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

