'use strict';

const fs = require('fs');
const os = require('os');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

// App-local provider adapter for Electron tray runtime.

const HOME = os.homedir();
const CODEX_APP_SERVER_TIMEOUT_MS = 7_000;
const SESSION_RATE_LIMIT_MAX_AGE_MS = 6 * 60 * 60_000;
const SESSION_SCAN_FILE_LIMIT = 20;
const CODEX_INIT_REQUEST_ID = 1;
const CODEX_RATE_LIMITS_REQUEST_ID = 2;
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const CLAUDE_OAUTH_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers';
const CLAUDE_OAUTH_CLIENT_ID =
  process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TRAY_APP_VERSION = require('./package.json').version;

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

    const withMtime = files.map((filePath) => {
      try {
        return { path: filePath, mtime: fs.statSync(filePath).mtimeMs };
      } catch {
        return { path: filePath, mtime: 0 };
      }
    });
    withMtime.sort((a, b) => b.mtime - a.mtime);

    let latest = null;
    for (const file of withMtime.slice(0, SESSION_SCAN_FILE_LIMIT).map((entry) => entry.path)) {
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
    const secondary = latest.rateLimits.secondary || null;
    const primaryUsed = Number(primary.used_percent ?? primary.usedPercent ?? 0);
    const secondaryUsed = Number(secondary?.used_percent ?? secondary?.usedPercent ?? 0);

    return {
      fiveHour: {
        utilization: Number.isFinite(primaryUsed) ? primaryUsed : 0,
        resetsAt: unixToIso(primary.resets_at ?? primary.resetsAt),
      },
      sevenDay: secondary
        ? {
            utilization: Number.isFinite(secondaryUsed) ? secondaryUsed : 0,
            resetsAt: unixToIso(secondary.resets_at ?? secondary.resetsAt),
          }
        : null,
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
        } catch (error) {
          reject(error);
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

module.exports = {
  getClaudeUsage,
  getCodexUsage,
  formatUsageErrorDetail,
};
