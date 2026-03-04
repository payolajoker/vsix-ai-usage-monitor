import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as path from 'path';
import { spawn } from 'child_process';
import * as readline from 'readline';

// App-local provider adapter for VS Code extension runtime.

const HOME = os.homedir();
const CODEX_APP_SERVER_TIMEOUT_MS = 7_000;
const SESSION_SCAN_FILE_LIMIT = 5;
const CODEX_INIT_REQUEST_ID = 1;
const CODEX_RATE_LIMITS_REQUEST_ID = 2;
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const CLAUDE_OAUTH_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers';
const CLAUDE_OAUTH_CLIENT_ID =
  process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export interface UsageResult {
  utilization: number;
  resetsAt: string;
}

export interface AgentUsage {
  fiveHour: UsageResult | null;
  sevenDay: UsageResult | null;
  error?: string;
}

interface CodexRateLimitWindow {
  usedPercent?: number;
  resetsAt?: number | null;
}

interface CodexRateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
}

interface CodexRateLimitsResult {
  rateLimits?: CodexRateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null;
}

interface ClaudeOauthCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | string;
  scopes?: string[];
  rateLimitTier?: string;
  subscriptionType?: string;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: ClaudeOauthCredentials;
  [key: string]: any;
}

export async function getClaudeUsage(): Promise<AgentUsage> {
  const credPath = path.join(HOME, '.claude', '.credentials.json');
  try {
    const cred = readClaudeCredentials(credPath);
    const token = cred.claudeAiOauth?.accessToken;
    if (!token) {
      throw new Error('Missing Claude access token in credentials');
    }

    try {
      const data = await fetchClaudeUsage(token);
      return mapClaudeUsage(data);
    } catch (usageError: any) {
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
  } catch (error: unknown) {
    return {
      fiveHour: null,
      sevenDay: null,
      error: formatUsageErrorDetail('claude', formatHttpError(error)),
    };
  }
}

function readClaudeCredentials(credPath: string): ClaudeCredentialsFile {
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8')) as ClaudeCredentialsFile;
  if (!cred?.claudeAiOauth) {
    throw new Error('Missing claudeAiOauth in credentials');
  }
  return cred;
}

function mapClaudeUsage(data: any): AgentUsage {
  return {
    fiveHour: data.five_hour
      ? { utilization: data.five_hour.utilization ?? 0, resetsAt: data.five_hour.resets_at ?? '' }
      : null,
    sevenDay: data.seven_day
      ? { utilization: data.seven_day.utilization ?? 0, resetsAt: data.seven_day.resets_at ?? '' }
      : null,
  };
}

function fetchClaudeUsage(token: string): Promise<any> {
  return httpsGet('api.anthropic.com', '/api/oauth/usage', {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': CLAUDE_OAUTH_BETA,
  });
}

function isClaudeTokenExpiredError(error: unknown): boolean {
  const text = String((error as any)?.message ?? error ?? '').toLowerCase();
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

async function refreshClaudeAccessToken(
  credPath: string,
  cred: ClaudeCredentialsFile
): Promise<ClaudeOauthCredentials> {
  const oauth = cred.claudeAiOauth ?? {};
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

  const accessToken = refreshed?.access_token;
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('Claude refresh response missing access_token');
  }

  const expiresIn = Number(refreshed?.expires_in ?? 0);
  const nextOauth: ClaudeOauthCredentials = {
    ...oauth,
    accessToken,
    refreshToken:
      typeof refreshed?.refresh_token === 'string' && refreshed.refresh_token
        ? refreshed.refresh_token
        : refreshToken,
    expiresAt: Date.now() + Math.max(0, expiresIn) * 1000,
  };

  if (typeof refreshed?.scope === 'string' && refreshed.scope.trim()) {
    nextOauth.scopes = refreshed.scope.trim().split(/\s+/);
  }

  cred.claudeAiOauth = nextOauth;
  writeJsonFileAtomic(credPath, cred);
  return nextOauth;
}

function writeJsonFileAtomic(filePath: string, data: unknown) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export async function getCodexUsage(): Promise<AgentUsage> {
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
      `app_server=${appServerUsage.error ?? ''}; sessions=${sessionUsage.error ?? ''}`
    ),
  };
}

async function getCodexUsageFromAppServer(): Promise<AgentUsage> {
  try {
    const result = await readCodexRateLimitsFromAppServer();
    const snapshot = pickCodexSnapshot(result);
    if (!snapshot?.primary) {
      return { fiveHour: null, sevenDay: null, error: 'No primary rate limit window from app server' };
    }

    return {
      fiveHour: mapCodexWindow(snapshot.primary),
      sevenDay: snapshot.secondary ? mapCodexWindow(snapshot.secondary) : null,
    };
  } catch (error: any) {
    return { fiveHour: null, sevenDay: null, error: String(error.message ?? error) };
  }
}

function readCodexRateLimitsFromAppServer(): Promise<CodexRateLimitsResult> {
  return new Promise((resolve, reject) => {
    const child = spawnCodexAppServerProcess();
    const rl = readline.createInterface({ input: child.stdout });

    let settled = false;
    let stderr = '';
    let requestTimer: NodeJS.Timeout | undefined;

    const doneResolve = (value: CodexRateLimitsResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (requestTimer) {
        clearTimeout(requestTimer);
      }
      rl.close();
      child.kill();
      resolve(value);
    };

    const doneReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (requestTimer) {
        clearTimeout(requestTimer);
      }
      rl.close();
      child.kill();
      reject(error);
    };

    child.on('error', (err) => {
      doneReject(new Error(`Failed to start codex app-server: ${err.message}`));
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4_000) {
        stderr = stderr.slice(-4_000);
      }
    });

    child.stdin.on('error', () => {
      // ignore EPIPE when the process exits while writing
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let msg: any;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (msg.id !== CODEX_RATE_LIMITS_REQUEST_ID) {
        return;
      }

      if (msg.error) {
        doneReject(new Error(`account/rateLimits/read failed: ${msg.error?.message ?? 'Unknown error'}`));
        return;
      }

      doneResolve((msg.result ?? {}) as CodexRateLimitsResult);
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      const detail = stderr.trim() ? ` stderr: ${stderr.trim()}` : '';
      doneReject(new Error(`codex app-server exited before response (code=${code}, signal=${signal}).${detail}`));
    });

    requestTimer = setTimeout(() => {
      doneReject(new Error('codex app-server request timed out'));
    }, CODEX_APP_SERVER_TIMEOUT_MS);

    const send = (payload: Record<string, any>) => {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    };

    send({
      jsonrpc: '2.0',
      id: CODEX_INIT_REQUEST_ID,
      method: 'initialize',
      params: {
        clientInfo: { name: 'ai-usage-monitor', version: '0.2.7' },
        capabilities: { experimentalApi: true },
      },
    });
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', id: CODEX_RATE_LIMITS_REQUEST_ID, method: 'account/rateLimits/read', params: null });
  });
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

function pickCodexSnapshot(result: CodexRateLimitsResult): CodexRateLimitSnapshot | null {
  const byLimitId = result.rateLimitsByLimitId;
  if (byLimitId && typeof byLimitId === 'object') {
    if (byLimitId.codex) {
      return byLimitId.codex;
    }

    for (const [key, value] of Object.entries(byLimitId)) {
      if (key.toLowerCase().includes('codex')) {
        return value;
      }
      const label = `${value.limitId ?? ''} ${value.limitName ?? ''}`.toLowerCase();
      if (label.includes('codex')) {
        return value;
      }
    }

    const first = Object.values(byLimitId)[0];
    if (first) {
      return first;
    }
  }

  return result.rateLimits ?? null;
}

function mapCodexWindow(window: CodexRateLimitWindow): UsageResult {
  return {
    utilization: window.usedPercent ?? 0,
    resetsAt: unixToIso(window.resetsAt),
  };
}

function unixToIso(ts: number | string | null | undefined): string {
  if (!ts) {
    return '';
  }
  const numericTs = Number(ts);
  if (!Number.isFinite(numericTs)) {
    const parsed = new Date(String(ts));
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }
  const ms = numericTs > 9_999_999_999 ? numericTs : numericTs * 1000;
  return new Date(ms).toISOString();
}

async function getCodexUsageFromSessions(): Promise<AgentUsage> {
  try {
    const sessionsDir = path.join(HOME, '.codex', 'sessions');
    const files = findJsonlFiles(sessionsDir);
    if (files.length === 0) {
      return { fiveHour: null, sevenDay: null, error: 'No session files found' };
    }

    const filesWithMtime = files.map((filePath) => {
      try {
        return { path: filePath, mtime: fs.statSync(filePath).mtimeMs };
      } catch {
        return { path: filePath, mtime: 0 };
      }
    });
    filesWithMtime.sort((a, b) => b.mtime - a.mtime);

    let rateLimits: any = null;
    for (const file of filesWithMtime.slice(0, SESSION_SCAN_FILE_LIMIT).map((entry) => entry.path)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) {
          continue;
        }
        try {
          const data = JSON.parse(line);
          if (data.type === 'event_msg' && data.payload?.type === 'token_count' && data.payload?.rate_limits) {
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

    const primary = rateLimits.primary ?? {};
    const secondary = rateLimits.secondary ?? null;
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
    };
  } catch (error: any) {
    return { fiveHour: null, sevenDay: null, error: String(error.message) };
  }
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  };

  walk(dir);
  return results;
}

class HttpStatusError extends Error {
  statusCode: number;
  responseBody: string;

  constructor(statusCode: number, message: string, responseBody: string) {
    super(message);
    this.name = 'HttpStatusError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function formatHttpError(error: unknown): string {
  if (error instanceof HttpStatusError) {
    return error.message;
  }
  return String((error as any)?.message ?? error);
}

function formatUsageErrorDetail(provider: 'claude' | 'codex', errorText: string): string {
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

function httpsGet(hostname: string, urlPath: string, headers: Record<string, string>): Promise<any> {
  return httpsJsonRequest('GET', hostname, urlPath, headers);
}

function httpsPost(
  hostname: string,
  urlPath: string,
  headers: Record<string, string>,
  body: unknown
): Promise<any> {
  return httpsJsonRequest('POST', hostname, urlPath, headers, body);
}

function httpsJsonRequest(
  method: 'GET' | 'POST',
  hostname: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<any> {
  return new Promise((resolve, reject) => {
    let payload = '';
    const reqHeaders: Record<string, string> = { ...headers };
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
          const status = res.statusCode ?? 0;
          let message = `HTTP ${status}`;
          try {
            const errBody = JSON.parse(raw);
            if (errBody?.error?.message) {
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
