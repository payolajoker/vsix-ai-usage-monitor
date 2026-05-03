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
const CLAUDE_OAUTH_SCOPE =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers';
const CLAUDE_OAUTH_CLIENT_ID =
  process.env.CLAUDE_CODE_OAUTH_CLIENT_ID ||
  '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const COPILOT_MAX_FILES_PER_SOURCE = 250;

interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
  cacheWrite?: number;
}

const COPILOT_MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
  'raptor-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15.0 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5.5': { input: 5.0, cachedInput: 0.5, output: 30.0 },
  'gpt-4.1': { input: 2.0, cachedInput: 0.5, output: 8.0 },
  'grok-code-fast-1': { input: 0.2, cachedInput: 0.02, output: 1.5 },
  'claude-haiku-4.5': {
    input: 1.0,
    cachedInput: 0.1,
    cacheWrite: 1.25,
    output: 5.0,
  },
  'claude-sonnet-4': {
    input: 3.0,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    output: 15.0,
  },
  'claude-sonnet-4.5': {
    input: 3.0,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    output: 15.0,
  },
  'claude-sonnet-4.6': {
    input: 3.0,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    output: 15.0,
  },
  'claude-opus-4.5': {
    input: 5.0,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 25.0,
  },
  'claude-opus-4.6': {
    input: 5.0,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 25.0,
  },
  'claude-opus-4.7': {
    input: 5.0,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 25.0,
  },
  'gemini-2.5-pro': { input: 1.25, cachedInput: 0.125, output: 10.0 },
  'gemini-3.1-pro': { input: 2.0, cachedInput: 0.2, output: 12.0 },
  'gemini-3-flash': { input: 0.5, cachedInput: 0.05, output: 3.0 },
  goldeneye: { input: 1.25, cachedInput: 0.125, output: 10.0 },
};

const MODEL_ALIASES: Record<string, string> = {
  'gpt-5.1': 'gpt-5.2',
  'gpt-5.1-codex': 'gpt-5.2-codex',
  'gpt-5.1-codex-mini': 'gpt-5.4-mini',
  'gpt-5.1-codex-max': 'gpt-5.2-codex',
  'gpt-4o': 'gpt-4.1',
  'gpt-4o-mini': 'gpt-5-mini',
  'gemini-3-pro': 'gemini-3.1-pro',
  'gemini-3-flash-preview': 'gemini-3-flash',
  'gemini-3-pro-preview': 'gemini-3.1-pro',
  'gemini-3.1-pro-preview': 'gemini-3.1-pro',
};

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface UsageResult {
  utilization: number;
  resetsAt: string;
}

export interface AgentUsage {
  fiveHour: UsageResult | null;
  sevenDay: UsageResult | null;
  error?: string;
  meta?: {
    segmentSuffix?: string;
    tooltipNotes?: string[];
    primaryLabel?: string;
    hideReset?: boolean;
    compactTooltip?: boolean;
  };
}

export interface CopilotUsageOptions {
  lookbackDays: number;
  includedCredits: number;
  autoModel?: string;
}

interface CopilotUsageRecord {
  sessionId?: string;
  timestampMs?: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
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
  const cred = JSON.parse(
    fs.readFileSync(credPath, 'utf8'),
  ) as ClaudeCredentialsFile;
  if (!cred?.claudeAiOauth) {
    throw new Error('Missing claudeAiOauth in credentials');
  }
  return cred;
}

function mapClaudeUsage(data: any): AgentUsage {
  return {
    fiveHour: data.five_hour
      ? {
          utilization: data.five_hour.utilization ?? 0,
          resetsAt: data.five_hour.resets_at ?? '',
        }
      : null,
    sevenDay: data.seven_day
      ? {
          utilization: data.seven_day.utilization ?? 0,
          resetsAt: data.seven_day.resets_at ?? '',
        }
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
    return (
      bodyText.includes('token_expired') ||
      bodyText.includes('token has expired')
    );
  }

  return false;
}

async function refreshClaudeAccessToken(
  credPath: string,
  cred: ClaudeCredentialsFile,
): Promise<ClaudeOauthCredentials> {
  const oauth = cred.claudeAiOauth ?? {};
  const refreshToken = oauth.refreshToken;
  if (!refreshToken) {
    throw new Error('Claude refresh token missing. Run `claude setup-token`.');
  }

  const refreshed = await httpsPost(
    'api.anthropic.com',
    '/v1/oauth/token',
    {},
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      scope: CLAUDE_OAUTH_SCOPE,
    },
  );

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
      `app_server=${appServerUsage.error ?? ''}; sessions=${sessionUsage.error ?? ''}`,
    ),
  };
}

export async function getCopilotUsage(
  options: CopilotUsageOptions,
): Promise<AgentUsage> {
  try {
    const lookbackDays = clampInteger(options.lookbackDays, 1, 365, 30);
    const includedCredits = Math.max(
      1,
      Number(options.includedCredits || 1000),
    );
    const autoModel = normalizeModel(options.autoModel || 'gpt-5.3-codex');
    const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

    const roots = getVsCodeWorkspaceStorageRoots().filter((root) =>
      fs.existsSync(root),
    );
    if (roots.length === 0) {
      return {
        fiveHour: null,
        sevenDay: null,
        error: formatUsageErrorDetail(
          'copilot',
          'No VS Code workspaceStorage directories found',
        ),
      };
    }

    const transcriptFiles = collectWorkspaceFiles(roots, 'transcript').slice(
      0,
      COPILOT_MAX_FILES_PER_SOURCE,
    );
    const chatFiles = collectWorkspaceFiles(roots, 'chat').slice(
      0,
      COPILOT_MAX_FILES_PER_SOURCE,
    );

    const records: CopilotUsageRecord[] = [];
    const exactSessionIds = new Set<string>();
    let exactTranscriptSessions = 0;

    for (const file of transcriptFiles) {
      const parsed = parseTranscriptFile(file, sinceMs);
      if (parsed.records.length > 0) {
        records.push(...parsed.records);
      }
      if (parsed.sessionId) {
        exactSessionIds.add(parsed.sessionId);
      }
      if (parsed.hasShutdown) {
        exactTranscriptSessions += 1;
      }
    }

    for (const file of chatFiles) {
      const parsed = parseChatSessionFile(file, sinceMs);
      if (parsed.sessionId && exactSessionIds.has(parsed.sessionId)) {
        continue;
      }
      records.push(...parsed.records);
    }

    if (records.length === 0) {
      return {
        fiveHour: null,
        sevenDay: null,
        error: formatUsageErrorDetail(
          'copilot',
          'No Copilot usage records found',
        ),
      };
    }

    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      credits: 0,
      unknownModels: new Set<string>(),
      zeroOutput: 0,
      modelCredits: new Map<string, number>(),
    };

    for (const record of records) {
      totals.inputTokens += record.inputTokens;
      totals.outputTokens += record.outputTokens;
      totals.cacheReadTokens += record.cacheReadTokens;
      totals.cacheWriteTokens += record.cacheWriteTokens;
      if (record.outputTokens <= 0) {
        totals.zeroOutput += 1;
      }

      const pricing = estimateCopilotCredits(record, autoModel);
      totals.credits += pricing.credits;
      totals.modelCredits.set(
        pricing.pricingModel,
        (totals.modelCredits.get(pricing.pricingModel) ?? 0) + pricing.credits,
      );
      if (!pricing.pricingKnown) {
        totals.unknownModels.add(pricing.pricingModel);
      }
    }

    const totalTokens =
      totals.inputTokens +
      totals.outputTokens +
      totals.cacheReadTokens +
      totals.cacheWriteTokens;
    const spendUsd = totals.credits / 100;
    const usedPercent = Math.max(
      0,
      Math.min(100, Math.round((totals.credits / includedCredits) * 100)),
    );
    const zeroOutputPct = Math.round(
      (totals.zeroOutput * 100) / records.length,
    );

    const tooltipNotes = [
      `${lookbackDays}d window`,
      `${formatInteger(records.length)} records`,
      `${formatInteger(totalTokens)} tokens`,
      `$${spendUsd.toFixed(2)} spend`,
      `${totals.credits.toFixed(1)} / ${includedCredits.toFixed(0)} credits (${usedPercent}%)`,
    ];

    if (exactTranscriptSessions > 0) {
      tooltipNotes.push(
        `${exactTranscriptSessions} session(s) used exact transcript shutdown metrics`,
      );
    }
    if (totals.unknownModels.size > 0) {
      tooltipNotes.push(
        `Unknown pricing model(s): ${Array.from(totals.unknownModels).slice(0, 3).join(', ')}`,
      );
    }
    if (zeroOutputPct >= 50) {
      tooltipNotes.push(
        'High zero-output ratio detected; historical Copilot logs may be incomplete.',
      );
    }

    const topPricedModels = [...totals.modelCredits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([model]) => model)
      .filter((model) => !totals.unknownModels.has(model));
    for (const model of topPricedModels) {
      const rate = COPILOT_MODEL_PRICES[model];
      if (!rate) {
        continue;
      }
      const modelSpendUsd = (totals.modelCredits.get(model) ?? 0) / 100;
      tooltipNotes.push(
        `${model}: $${modelSpendUsd.toFixed(2)} (in $${formatRate(rate.input)}, cached $${formatRate(rate.cachedInput)}, out $${formatRate(rate.output)} /1M)`,
      );
    }

    return {
      fiveHour: {
        utilization: usedPercent,
        resetsAt: '',
      },
      sevenDay: null,
      meta: {
        segmentSuffix: `$${formatCompactCurrency(spendUsd)} ${formatCompactNumber(totalTokens)} tok`,
        tooltipNotes,
        hideReset: true,
        compactTooltip: true,
      },
    };
  } catch (error: unknown) {
    return {
      fiveHour: null,
      sevenDay: null,
      error: formatUsageErrorDetail(
        'copilot',
        String((error as any)?.message ?? error),
      ),
    };
  }
}

async function getCodexUsageFromAppServer(): Promise<AgentUsage> {
  try {
    const result = await readCodexRateLimitsFromAppServer();
    const snapshot = pickCodexSnapshot(result);
    if (!snapshot?.primary) {
      return {
        fiveHour: null,
        sevenDay: null,
        error: 'No primary rate limit window from app server',
      };
    }

    return {
      fiveHour: mapCodexWindow(snapshot.primary),
      sevenDay: snapshot.secondary ? mapCodexWindow(snapshot.secondary) : null,
    };
  } catch (error: any) {
    return {
      fiveHour: null,
      sevenDay: null,
      error: String(error.message ?? error),
    };
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
        doneReject(
          new Error(
            `account/rateLimits/read failed: ${msg.error?.message ?? 'Unknown error'}`,
          ),
        );
        return;
      }

      doneResolve((msg.result ?? {}) as CodexRateLimitsResult);
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      const detail = stderr.trim() ? ` stderr: ${stderr.trim()}` : '';
      doneReject(
        new Error(
          `codex app-server exited before response (code=${code}, signal=${signal}).${detail}`,
        ),
      );
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
    send({
      jsonrpc: '2.0',
      id: CODEX_RATE_LIMITS_REQUEST_ID,
      method: 'account/rateLimits/read',
      params: null,
    });
  });
}

function spawnCodexAppServerProcess() {
  if (process.platform === 'win32') {
    return spawn(
      'cmd.exe',
      ['/d', '/s', '/c', 'codex app-server --listen stdio://'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
  }
  return spawn('codex', ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function pickCodexSnapshot(
  result: CodexRateLimitsResult,
): CodexRateLimitSnapshot | null {
  return pickRateLimitSnapshot(result, ['codex']);
}

function pickRateLimitSnapshot(
  result: CodexRateLimitsResult,
  preferredKeywords: string[],
): CodexRateLimitSnapshot | null {
  const byLimitId = result.rateLimitsByLimitId;
  if (byLimitId && typeof byLimitId === 'object') {
    for (const keyword of preferredKeywords) {
      const direct = byLimitId[keyword];
      if (direct) {
        return direct;
      }
    }

    for (const [key, value] of Object.entries(byLimitId)) {
      const loweredKey = key.toLowerCase();
      if (preferredKeywords.some((keyword) => loweredKey.includes(keyword))) {
        return value;
      }
      const label =
        `${value.limitId ?? ''} ${value.limitName ?? ''}`.toLowerCase();
      if (preferredKeywords.some((keyword) => label.includes(keyword))) {
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
      return {
        fiveHour: null,
        sevenDay: null,
        error: 'No session files found',
      };
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
    for (const file of filesWithMtime
      .slice(0, SESSION_SCAN_FILE_LIMIT)
      .map((entry) => entry.path)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) {
          continue;
        }
        try {
          const data = JSON.parse(line);
          if (
            data.type === 'event_msg' &&
            data.payload?.type === 'token_count' &&
            data.payload?.rate_limits
          ) {
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
    const primaryUsed = Number(
      primary.used_percent ?? primary.usedPercent ?? 0,
    );
    const secondaryUsed = Number(
      secondary?.used_percent ?? secondary?.usedPercent ?? 0,
    );
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

function collectWorkspaceFiles(
  roots: string[],
  mode: 'chat' | 'transcript',
): string[] {
  const files: string[] = [];
  for (const root of roots) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const workspaceDir = path.join(root, entry.name);
      const targetDir =
        mode === 'chat'
          ? path.join(workspaceDir, 'chatSessions')
          : path.join(workspaceDir, 'GitHub.copilot-chat', 'transcripts');
      files.push(...findJsonlFiles(targetDir));
    }
  }

  return files.sort((a, b) => getFileMtimeMs(b) - getFileMtimeMs(a));
}

function getFileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function parseTranscriptFile(
  filePath: string,
  sinceMs: number,
): { records: CopilotUsageRecord[]; sessionId?: string; hasShutdown: boolean } {
  const records: CopilotUsageRecord[] = [];
  let sessionId: string | undefined;
  let hasShutdown = false;

  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === 'session.start') {
      sessionId = event.data?.sessionId ?? sessionId;
    }
    if (event.type !== 'session.shutdown' || !event.data?.modelMetrics) {
      continue;
    }

    const timestampMs = toTimestampMs(event.timestamp);
    if (timestampMs && timestampMs < sinceMs) {
      continue;
    }

    hasShutdown = true;
    const metrics = event.data.modelMetrics;
    for (const [model, metric] of Object.entries<any>(metrics)) {
      const usage = metric?.usage ?? {};
      records.push({
        sessionId: sessionId ?? event.data?.sessionId,
        timestampMs,
        model: normalizeModel(model),
        inputTokens: Number(usage.inputTokens ?? 0) || 0,
        outputTokens: Number(usage.outputTokens ?? 0) || 0,
        cacheReadTokens: Number(usage.cacheReadTokens ?? 0) || 0,
        cacheWriteTokens: Number(usage.cacheWriteTokens ?? 0) || 0,
      });
    }
  }

  return { records, sessionId, hasShutdown };
}

function parseChatSessionFile(
  filePath: string,
  sinceMs: number,
): { records: CopilotUsageRecord[]; sessionId?: string } {
  const records: CopilotUsageRecord[] = [];
  const { session, requests } = collectSessionRequests(filePath);
  const sessionModel = getSessionSelectedModel(session);
  const sessionId =
    session.sessionId || path.basename(filePath).replace(/\.jsonl$/i, '');

  for (const request of requests) {
    const timestampMs = toTimestampMs(request?.timestamp);
    if (timestampMs && timestampMs < sinceMs) {
      continue;
    }

    const metadata = request?.result?.metadata ?? {};
    const inputTokens =
      roughTokens(metadata.renderedUserMessage) +
      roughTokens(metadata.renderedGlobalContext);
    const outputTokens = Number(request?.completionTokens ?? 0);

    records.push({
      sessionId,
      timestampMs,
      model: modelFromRequest(request, sessionModel),
      inputTokens,
      outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  }

  return { records, sessionId };
}

function collectSessionRequests(filePath: string): {
  session: any;
  requests: any[];
} {
  const state: any = Object.create(null);
  const requestsById = new Map<string, any>();

  const captureRequest = (request: any) => {
    if (!request || typeof request !== 'object') {
      return;
    }
    const requestId = request.requestId;
    if (typeof requestId !== 'string' || !requestId) {
      return;
    }
    const existing = requestsById.get(requestId);
    if (existing) {
      const prevTokens = Number(existing.completionTokens ?? 0) || 0;
      const newTokens = Number(request.completionTokens ?? 0) || 0;
      requestsById.set(requestId, {
        ...existing,
        ...request,
        completionTokens: Math.max(prevTokens, newTokens),
      });
      return;
    }
    requestsById.set(requestId, request);
  };

  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.kind === 0) {
      Object.assign(state, event.v ?? {});
      for (const request of state.requests ?? []) {
        captureRequest(request);
      }
      continue;
    }

    if ((event.kind === 1 || event.kind === 2) && Array.isArray(event.k)) {
      setPath(state, event.k, event.v);
      if (event.k[0] !== 'requests') {
        continue;
      }
      if (event.k.length === 1) {
        for (const request of state.requests ?? []) {
          captureRequest(request);
        }
        continue;
      }
      const requestIndex = event.k[1];
      if (typeof requestIndex === 'number') {
        captureRequest(state.requests?.[requestIndex]);
      }
    }
  }

  return {
    session: state,
    requests: [...requestsById.values()],
  };
}

function setPath(
  target: any,
  jsonPath: Array<string | number>,
  value: unknown,
) {
  let cursor = target;
  for (let index = 0; index < jsonPath.length - 1; index++) {
    const key = jsonPath[index];
    if (typeof key === 'string' && UNSAFE_KEYS.has(key)) {
      return;
    }
    const nextKey = jsonPath[index + 1];
    if (cursor[key] == null) {
      cursor[key] = typeof nextKey === 'number' ? [] : {};
    }
    cursor = cursor[key];
  }
  const lastKey = jsonPath[jsonPath.length - 1];
  if (typeof lastKey === 'string' && UNSAFE_KEYS.has(lastKey)) {
    return;
  }
  cursor[lastKey] = value;
}

function resolveRequestModel(request: any): string {
  const directCandidates = [
    request?.resolvedModel,
    request?.model,
    request?.modelName,
    request?.modelId,
    request?.result?.resolvedModel,
    request?.result?.model,
    request?.result?.modelId,
    request?.result?.metadata?.model,
    request?.result?.metadata?.modelId,
    request?.response?.resolvedModel,
    request?.response?.model,
    request?.response?.modelId,
    request?.selectedModel?.identifier,
    request?.selectedModel?.metadata?.version,
    request?.selectedModel?.metadata?.family,
    request?.inputState?.selectedModel?.identifier,
    request?.inputState?.selectedModel?.metadata?.version,
    request?.inputState?.selectedModel?.metadata?.family,
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeModelCandidate(candidate);
    if (normalized && normalized !== 'auto') {
      return normalized;
    }
  }

  const details = String(request?.details ?? '').toLowerCase();
  const detailsMatch = details.match(
    /(gpt-[a-z0-9.-]+|claude-[a-z0-9.-]+|gemini-[a-z0-9.-]+|grok-[a-z0-9.-]+)/,
  );
  if (detailsMatch?.[1]) {
    return normalizeModel(detailsMatch[1]);
  }

  if (details.includes('auto')) {
    return 'auto';
  }
  return 'auto';
}

function modelFromRequest(request: any, sessionModel: string): string {
  const requestModel = resolveRequestModel(request);
  if (requestModel !== 'auto') {
    return requestModel;
  }
  return sessionModel || 'auto';
}

function normalizeModelCandidate(value: unknown): string | null {
  const normalized = normalizeModel(String(value ?? ''));
  return normalized ? normalized : null;
}

function getSessionSelectedModel(session: any): string {
  const selected = session?.inputState?.selectedModel;
  const candidates = [
    selected?.metadata?.version,
    selected?.metadata?.family,
    selected?.identifier,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeModelCandidate(candidate);
    if (normalized && normalized !== 'auto') {
      return normalized;
    }
  }
  return 'auto';
}

function normalizeModel(model: string): string {
  const normalized = String(model || '')
    .toLowerCase()
    .replace(/^copilot\//, '')
    .replace(/_/g, '-')
    .trim();
  if (!normalized) {
    return 'auto';
  }
  return MODEL_ALIASES[normalized] ?? normalized;
}

function estimateCopilotCredits(
  record: CopilotUsageRecord,
  autoModel: string,
): { credits: number; pricingKnown: boolean; pricingModel: string } {
  const rawModel = normalizeModel(record.model);
  const pricingModel =
    rawModel === 'auto' ? normalizeModel(autoModel) : rawModel;
  const price = COPILOT_MODEL_PRICES[pricingModel];
  if (!price) {
    return { credits: 0, pricingKnown: false, pricingModel };
  }

  const nonCachedInput = Math.max(
    0,
    record.inputTokens - record.cacheReadTokens,
  );
  const usd =
    (nonCachedInput * price.input +
      record.cacheReadTokens * price.cachedInput +
      record.cacheWriteTokens * (price.cacheWrite ?? price.cachedInput) +
      record.outputTokens * price.output) /
    1_000_000;
  return {
    credits: usd * 100,
    pricingKnown: true,
    pricingModel,
  };
}

function roughTokens(value: unknown): number {
  const text = String(value ?? '');
  if (!text.trim()) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function toTimestampMs(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const text = String(value).trim();
  if (!text) {
    return undefined;
  }
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value
    .toFixed(3)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

function formatCompactCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (value >= 100) {
    return `${value.toFixed(0)}`;
  }
  if (value >= 10) {
    return `${value.toFixed(1).replace(/\.0$/, '')}`;
  }
  return `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function getVsCodeWorkspaceStorageRoots(): string[] {
  const roots: string[] = [];
  if (process.platform === 'darwin') {
    roots.push(
      path.join(
        HOME,
        'Library',
        'Application Support',
        'Code',
        'User',
        'workspaceStorage',
      ),
      path.join(
        HOME,
        'Library',
        'Application Support',
        'Code - Insiders',
        'User',
        'workspaceStorage',
      ),
    );
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      roots.push(
        path.join(appData, 'Code', 'User', 'workspaceStorage'),
        path.join(appData, 'Code - Insiders', 'User', 'workspaceStorage'),
      );
    }
  }

  roots.push(
    path.join(HOME, '.config', 'Code', 'User', 'workspaceStorage'),
    path.join(HOME, '.config', 'Code - Insiders', 'User', 'workspaceStorage'),
  );

  return [...new Set(roots)];
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

function formatUsageErrorDetail(
  provider: 'claude' | 'codex' | 'copilot',
  errorText: string,
): string {
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

  if (provider === 'codex') {
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
      (text.includes('enoent') ||
        text.includes('not recognized') ||
        text.includes('cannot find'))
    ) {
      return 'CODEX CLI NOT FOUND (check codex install)';
    }
    if (
      text.includes('no session files found') ||
      text.includes('no rate limits data')
    ) {
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

  if (
    text.includes('workspace') ||
    text.includes('no copilot usage records') ||
    text.includes('chat session') ||
    text.includes('transcript')
  ) {
    return 'COPILOT DATA MISSING (open Copilot Chat first)';
  }
  if (text.includes('permission') || text.includes('eacces')) {
    return 'COPILOT DATA PERMISSION ERROR';
  }
  return 'COPILOT USAGE UNAVAILABLE';
}

function httpsGet(
  hostname: string,
  urlPath: string,
  headers: Record<string, string>,
): Promise<any> {
  return httpsJsonRequest('GET', hostname, urlPath, headers);
}

function httpsPost(
  hostname: string,
  urlPath: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<any> {
  return httpsJsonRequest('POST', hostname, urlPath, headers, body);
}

function httpsJsonRequest(
  method: 'GET' | 'POST',
  hostname: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: unknown,
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

    const req = https.request(
      { hostname, path: urlPath, method, headers: reqHeaders },
      (res) => {
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
      },
    );

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
