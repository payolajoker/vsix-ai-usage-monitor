const { app, Tray, Menu, Notification, nativeImage, BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const HOME = os.homedir();
const REFRESH_MS = 60_000;
const WARN_THRESHOLD = 70;
const DANGER_THRESHOLD = 85;
const STALE_AFTER_MS = 3 * 60_000;
const ACTIVE_PROVIDER_HOLD_MS = 7 * 60_000;
const CODEX_APP_SERVER_TIMEOUT_MS = 7_000;
const CODEX_INIT_REQUEST_ID = 1;
const CODEX_RATE_LIMITS_REQUEST_ID = 2;
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const CLAUDE_OAUTH_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers';
const CLAUDE_OAUTH_CLIENT_ID =
  process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const MINI_WIDTH = 560;
const MINI_HEIGHT = 228;
const MINI_HEIGHT_DETAILS = 560;

let tray = null;
let miniWin = null;
let miniReady = false;
let miniVisible = true;
let pendingMiniPayload = null;
let refreshTimer = null;
let isQuitting = false;
let miniDetailsVisible = false;
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

app.setAppUserModelId('com.payolajoker.aiusagetray');
app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.whenReady().then(() => {
  createTray();
  createMiniWindow();
  registerIpc();
  registerDisplayListeners();
  refreshNow();
  refreshTimer = setInterval(refreshNow, REFRESH_MS);
});

app.on('before-quit', () => {
  isQuitting = true;
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'win32') {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('AI Usage Tray');
  tray.setContextMenu(buildInitialMenu());
  tray.on('click', () => refreshNow());
}

function buildInitialMenu() {
  return Menu.buildFromTemplate([
    { label: 'Loading usage...', enabled: false },
    { type: 'separator' },
    catFocusMenuTemplate(),
    detailsMenuTemplate(),
    { label: miniVisible ? 'Hide Mini Window' : 'Show Mini Window', click: () => toggleMiniWindow() },
    { label: 'Reposition Mini Window', click: () => positionMiniWindow() },
    { type: 'separator' },
    { label: 'Refresh Now', click: () => refreshNow() },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createMiniWindow() {
  miniReady = false;
  pendingMiniPayload = null;

  miniWin = new BrowserWindow({
    width: MINI_WIDTH,
    height: getMiniHeight(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  miniWin.setMenuBarVisibility(false);
  miniWin.setAlwaysOnTop(true, 'screen-saver');
  miniWin.loadFile(path.join(__dirname, 'mini.html'));

  miniWin.webContents.on('did-finish-load', () => {
    miniReady = true;
    positionMiniWindow();
    if (miniVisible) {
      miniWin.showInactive();
    }
    if (pendingMiniPayload) {
      miniWin.webContents.send('usage-update', pendingMiniPayload);
      pendingMiniPayload = null;
    }
  });

  miniWin.on('close', (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    miniVisible = false;
    miniWin.hide();
    if (lastUsage.claude && lastUsage.codex) {
      updateTray(lastUsage.claude, lastUsage.codex);
    } else {
      tray.setContextMenu(buildInitialMenu());
    }
  });

  miniWin.on('closed', () => {
    miniReady = false;
    miniWin = null;
  });
}

function registerIpc() {
  ipcMain.on('mini-set-focus-mode', (_event, nextMode) => {
    applyFocusMode(nextMode);
  });

  ipcMain.on('mini-toggle-details', (_event, nextVisible) => {
    setMiniDetailsVisible(Boolean(nextVisible));
  });
}

function registerDisplayListeners() {
  const reposition = () => {
    if (miniVisible) {
      positionMiniWindow();
    }
  };
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
}

function getMiniHeight() {
  return miniDetailsVisible ? MINI_HEIGHT_DETAILS : MINI_HEIGHT;
}

function setMiniDetailsVisible(nextVisible) {
  if (miniDetailsVisible === nextVisible) {
    return;
  }

  miniDetailsVisible = nextVisible;
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.setSize(MINI_WIDTH, getMiniHeight(), false);
    if (miniVisible) {
      positionMiniWindow();
    }
  }

  if (lastUsage.claude || lastUsage.codex) {
    updateTray(lastUsage.claude, lastUsage.codex);
    updateMiniWindow(lastUsage.claude, lastUsage.codex, lastMiniMeta);
  } else {
    tray.setContextMenu(buildInitialMenu());
  }
}

function positionMiniWindow() {
  if (!miniWin || miniWin.isDestroyed()) {
    return;
  }

  const area = screen.getPrimaryDisplay().workArea;
  const x = Math.round(area.x + area.width - MINI_WIDTH - 10);
  const y = Math.round(area.y + area.height - getMiniHeight() - 10);
  miniWin.setPosition(x, y, false);
}

function toggleMiniWindow() {
  if (!miniWin || miniWin.isDestroyed()) {
    miniVisible = true;
    createMiniWindow();
    if (lastUsage.claude && lastUsage.codex) {
      updateMiniWindow(lastUsage.claude, lastUsage.codex, lastMiniMeta);
    }
    return;
  }

  miniVisible = !miniVisible;
  if (miniVisible) {
    positionMiniWindow();
    miniWin.showInactive();
    if (lastUsage.claude && lastUsage.codex) {
      updateMiniWindow(lastUsage.claude, lastUsage.codex, lastMiniMeta);
    }
  } else {
    miniWin.hide();
  }

  if (lastUsage.claude && lastUsage.codex) {
    updateTray(lastUsage.claude, lastUsage.codex);
  } else {
    tray.setContextMenu(buildInitialMenu());
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
    updateTray(lastUsage.claude, lastUsage.codex);
    updateMiniWindow(lastUsage.claude, lastUsage.codex, lastMiniMeta);
  } else {
    tray.setContextMenu(buildInitialMenu());
  }
}

async function refreshNow() {
  const [claude, codex] = await Promise.all([getClaudeUsage(), getCodexUsage()]);
  lastMiniMeta = buildMiniMeta(claude, codex, { updateHistory: true });
  lastUsage = { claude, codex };
  updateTray(claude, codex);
  updateMiniWindow(claude, codex, lastMiniMeta);
  maybeNotify('Claude', claude, 'ratio');
  maybeNotify('Codex', codex, 'percent');
}

function catFocusMenuTemplate() {
  return {
    label: `Cat Focus (${focusMode.toUpperCase()})`,
    submenu: [
      { label: 'Auto', type: 'radio', checked: focusMode === 'auto', click: () => applyFocusMode('auto') },
      { label: 'Claude', type: 'radio', checked: focusMode === 'claude', click: () => applyFocusMode('claude') },
      { label: 'Codex', type: 'radio', checked: focusMode === 'codex', click: () => applyFocusMode('codex') },
    ],
  };
}

function detailsMenuTemplate() {
  return {
    label: 'Show Details Panel',
    type: 'checkbox',
    checked: miniDetailsVisible,
    click: (item) => setMiniDetailsVisible(item.checked),
  };
}

function updateTray(claude, codex) {
  const claudeSegment = toSegment('C', 'claude', claude, 'ratio');
  const codexSegment = toSegment('O', 'codex', codex, 'percent');

  const tooltip = `AI Usage - ${claudeSegment.compact} | ${codexSegment.compact}`;
  tray.setToolTip(tooltip);

  const template = [
    { label: `Claude 5h: ${claudeSegment.fiveHour}`, enabled: false },
    { label: `Claude 7d: ${claudeSegment.sevenDay}`, enabled: false },
    { type: 'separator' },
    { label: `Codex 5h: ${codexSegment.fiveHour}`, enabled: false },
    { label: `Codex 7d: ${codexSegment.sevenDay}`, enabled: false },
    { type: 'separator' },
    catFocusMenuTemplate(),
    detailsMenuTemplate(),
    { label: miniVisible ? 'Hide Mini Window' : 'Show Mini Window', click: () => toggleMiniWindow() },
    { label: 'Reposition Mini Window', click: () => positionMiniWindow() },
    { type: 'separator' },
    { label: 'Refresh Now', click: () => refreshNow() },
    { label: 'Quit', click: () => app.quit() },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function toSegment(shortName, provider, usage, scale) {
  if (usage.error || !usage.fiveHour) {
    const reason = summarizeUsageError(provider, usage.error || 'No data');
    return {
      compact: `${shortName} --`,
      fiveHour: `-- (${reason})`,
      sevenDay: '--',
    };
  }

  const used5h = toPercent(usage.fiveHour.utilization, scale);
  const reset5h = formatReset(usage.fiveHour.resetsAt);
  const compact = `${shortName} ${used5h}%${reset5h ? ` ${reset5h}` : ''}`;
  const fiveHour = `${used5h}%${reset5h ? ` (resets ${reset5h})` : ''}`;

  let sevenDay = '--';
  if (usage.sevenDay) {
    const used7d = toPercent(usage.sevenDay.utilization, scale);
    const reset7d = formatReset(usage.sevenDay.resetsAt);
    sevenDay = `${used7d}%${reset7d ? ` (resets ${reset7d})` : ''}`;
  }

  return { compact, fiveHour, sevenDay };
}

function updateMiniWindow(claude, codex, meta = makeDefaultMiniMeta()) {
  if (!miniWin || miniWin.isDestroyed()) {
    return;
  }

  const payload = {
    claude: toMiniPayload('claude', claude, 'ratio', meta.trend.claude, meta.changed.claude, meta.crossings.claude),
    codex: toMiniPayload('codex', codex, 'percent', meta.trend.codex, meta.changed.codex, meta.crossings.codex),
    updatedAt: new Date().toLocaleTimeString(),
    focusMode: meta.focusMode,
    activeProvider: meta.activeProvider,
    state: meta.state,
    stale: meta.stale,
    detailsVisible: miniDetailsVisible,
  };

  if (!miniReady) {
    pendingMiniPayload = payload;
    return;
  }

  miniWin.webContents.send('usage-update', payload);
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
    };
  }

  const used5h = toPercent(usage.fiveHour.utilization, scale);
  const used7d = usage.sevenDay ? toPercent(usage.sevenDay.utilization, scale) : null;
  const reset5h = formatReset(usage.fiveHour.resetsAt);
  const reset7d = usage.sevenDay ? formatReset(usage.sevenDay.resetsAt) : '';
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
  };
}

function summarizeUsageError(provider, errorText) {
  const detail = formatUsageErrorDetail(provider, errorText);
  const text = String(detail || '').toLowerCase();
  if (!text) {
    return 'NO DATA';
  }

  if (text.includes('claude cli relogin required')) {
    return 'CLAUDE CLI RELOGIN REQUIRED';
  }
  if (text.includes('claude cli login required')) {
    return 'CLAUDE CLI LOGIN REQUIRED';
  }
  if (text.includes('codex cli login required')) {
    return 'CODEX CLI LOGIN REQUIRED';
  }
  if (text.includes('codex cli data missing')) {
    return 'RUN CODEX ONCE';
  }
  if (text.includes('codex cli not found')) {
    return 'CODEX CLI NOT FOUND';
  }
  if (text.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (detail.length > 42) {
    return `${detail.slice(0, 42)}...`;
  }
  return detail;
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
  } else if (Math.max(levelClaude, levelCodex) >= 1) {
    state = 'WATCH';
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
      title: `AI Usage Tray - ${name}`,
      body: `${stage}: ${used}% used in 5-hour window.`,
    }).show();
  }

  lastLevels[key] = level;
}

function toPercent(utilization, scale) {
  const raw = scale === 'ratio' && utilization <= 1 ? utilization * 100 : utilization;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function formatReset(iso) {
  if (!iso) {
    return '';
  }
  try {
    const diff = Math.max(0, new Date(iso).getTime() - Date.now());
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
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
  fs.writeFileSync(credPath, `${JSON.stringify(cred, null, 2)}\n`, 'utf8');
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
    };
  } catch (error) {
    return { fiveHour: null, sevenDay: null, error: String(error.message || error) };
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
      try {
        child.kill();
      } catch {}
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
      try {
        child.kill();
      } catch {}
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
        clientInfo: { name: 'ai-usage-tray', version: '0.1.0' },
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

function spawnCodexAppServerProcess() {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'codex app-server --listen stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }
  return spawn('codex', ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
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
  return {
    utilization: window.usedPercent || 0,
    resetsAt: unixToIso(window.resetsAt),
  };
}

function unixToIso(ts) {
  if (!ts) {
    return '';
  }
  const ms = ts > 9_999_999_999 ? ts : ts * 1000;
  return new Date(ms).toISOString();
}

async function getCodexUsageFromSessions() {
  try {
    const sessionsDir = path.join(HOME, '.codex', 'sessions');
    const files = findJsonlFiles(sessionsDir);
    if (files.length === 0) {
      return { fiveHour: null, sevenDay: null, error: 'No session files found' };
    }

    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    let rateLimits = null;
    for (const file of files.slice(0, 5)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) {
          continue;
        }
        try {
          const data = JSON.parse(line);
          if (data.type === 'event_msg' && data.payload && data.payload.type === 'token_count' && data.payload.rate_limits) {
            rateLimits = data.payload.rate_limits;
          }
        } catch {
          // skip malformed lines
        }
      }
      if (rateLimits) {
        break;
      }
    }

    if (!rateLimits) {
      return { fiveHour: null, sevenDay: null, error: 'No rate limits data' };
    }

    const toIso = (ts) => (ts ? new Date(ts * 1000).toISOString() : '');
    return {
      fiveHour: {
        utilization: (rateLimits.primary && rateLimits.primary.used_percent) || 0,
        resetsAt: toIso(rateLimits.primary && rateLimits.primary.resets_at),
      },
      sevenDay: {
        utilization: (rateLimits.secondary && rateLimits.secondary.used_percent) || 0,
        resetsAt: toIso(rateLimits.secondary && rateLimits.secondary.resets_at),
      },
    };
  } catch (error) {
    return { fiveHour: null, sevenDay: null, error: String(error.message || error) };
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
  if (text.includes('timed out') || text.includes('timeout')) {
    return 'CODEX CLI TIMEOUT';
  }
  if (text.includes('app-server')) {
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
