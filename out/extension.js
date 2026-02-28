"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const https = __importStar(require("https"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const readline = __importStar(require("readline"));
const HOME = os.homedir();
const CODEX_APP_SERVER_TIMEOUT_MS = 7000;
const CODEX_INIT_REQUEST_ID = 1;
const CODEX_RATE_LIMITS_REQUEST_ID = 2;
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const CLAUDE_OAUTH_SCOPE = 'user:profile user:inference user:sessions:claude_code user:mcp_servers';
const CLAUDE_OAUTH_CLIENT_ID = process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
let usageBar;
let timer;
function activate(context) {
    usageBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    usageBar.show();
    context.subscriptions.push(usageBar);
    doRefresh();
    timer = setInterval(doRefresh, 60000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
async function doRefresh() {
    const [claude, codex] = await Promise.all([getClaudeUsage(), getCodexUsage()]);
    renderCombinedBar(usageBar, claude, codex);
}
function toPercent(utilization, scale) {
    const raw = scale === 'ratio' && utilization <= 1 ? utilization * 100 : utilization;
    return Math.max(0, Math.min(100, Math.round(raw)));
}
function renderCombinedBar(bar, claude, codex) {
    const claudeSegment = formatSegment('🟠', 'C', claude, 'ratio');
    const codexSegment = formatSegment('🔵', 'O', codex, 'percent');
    bar.text = `${claudeSegment}  |  ${codexSegment}`;
    const claude5h = getFiveHourPercent(claude, 'ratio');
    const codex5h = getFiveHourPercent(codex, 'percent');
    const usable = [claude5h, codex5h].filter((v) => typeof v === 'number');
    if (usable.length === 0) {
        bar.color = '#6e7681';
    }
    else {
        const maxUsed = Math.max(...usable);
        bar.color = maxUsed >= 85 ? '#f85149' : maxUsed >= 70 ? '#d29922' : undefined;
    }
    const tip = new vscode.MarkdownString();
    tip.isTrusted = true;
    appendUsageTooltip(tip, 'Claude', claude, 'ratio');
    tip.appendMarkdown('\n');
    appendUsageTooltip(tip, 'Codex', codex, 'percent');
    bar.tooltip = tip;
}
function getFiveHourPercent(data, scale) {
    if (data.error || !data.fiveHour) {
        return null;
    }
    return toPercent(data.fiveHour.utilization, scale);
}
function formatSegment(emoji, label, data, scale) {
    if (data.error || !data.fiveHour) {
        return `${emoji} ${label} --`;
    }
    const used5h = toPercent(data.fiveHour.utilization, scale);
    const reset5h = formatReset(data.fiveHour.resetsAt);
    return `${emoji} ${label} ${used5h}%${reset5h ? ` ${reset5h}` : ''}`;
}
function appendUsageTooltip(tip, name, data, scale) {
    tip.appendMarkdown(`**${name}**\n\n`);
    if (data.error || !data.fiveHour) {
        tip.appendMarkdown(`- ${data.error ?? 'No data available'}\n`);
        return;
    }
    const used5h = toPercent(data.fiveHour.utilization, scale);
    const reset5h = formatReset(data.fiveHour.resetsAt);
    tip.appendMarkdown(`| | Used | Resets In |\n|---|---|---|\n`);
    tip.appendMarkdown(`| 5-Hour Session | **${used5h}%** | ${reset5h || '--'} |\n`);
    if (data.sevenDay) {
        const used7d = toPercent(data.sevenDay.utilization, scale);
        const reset7d = formatReset(data.sevenDay.resetsAt);
        tip.appendMarkdown(`| 7-Day Weekly | **${used7d}%** | ${reset7d || '--'} |\n`);
    }
}
function formatReset(iso) {
    if (!iso) {
        return '';
    }
    try {
        const diff = Math.max(0, new Date(iso).getTime() - Date.now());
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        if (h > 0) {
            return `${h}h ${m}m`;
        }
        if (m > 0) {
            return `${m}m`;
        }
        return 'soon';
    }
    catch {
        return '';
    }
}
// Claude usage
async function getClaudeUsage() {
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
        }
        catch (usageError) {
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
    }
    catch (e) {
        return { fiveHour: null, sevenDay: null, error: formatUsageErrorDetail('claude', formatHttpError(e)) };
    }
}
function readClaudeCredentials(credPath) {
    const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    if (!cred?.claudeAiOauth) {
        throw new Error('Missing claudeAiOauth in credentials');
    }
    return cred;
}
function mapClaudeUsage(data) {
    return {
        fiveHour: data.five_hour
            ? { utilization: data.five_hour.utilization ?? 0, resetsAt: data.five_hour.resets_at ?? '' }
            : null,
        sevenDay: data.seven_day
            ? { utilization: data.seven_day.utilization ?? 0, resetsAt: data.seven_day.resets_at ?? '' }
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
    const text = String(error?.message ?? error ?? '').toLowerCase();
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
    const nextOauth = {
        ...oauth,
        accessToken,
        refreshToken: typeof refreshed?.refresh_token === 'string' && refreshed.refresh_token
            ? refreshed.refresh_token
            : refreshToken,
        expiresAt: Date.now() + Math.max(0, expiresIn) * 1000,
    };
    if (typeof refreshed?.scope === 'string' && refreshed.scope.trim()) {
        nextOauth.scopes = refreshed.scope.trim().split(/\s+/);
    }
    cred.claudeAiOauth = nextOauth;
    fs.writeFileSync(credPath, `${JSON.stringify(cred, null, 2)}\n`, 'utf8');
    return nextOauth;
}
// Codex usage
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
        error: formatUsageErrorDetail('codex', `app_server=${appServerUsage.error ?? ''}; sessions=${sessionUsage.error ?? ''}`),
    };
}
async function getCodexUsageFromAppServer() {
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
    }
    catch (e) {
        return { fiveHour: null, sevenDay: null, error: String(e.message ?? e) };
    }
}
function readCodexRateLimitsFromAppServer() {
    return new Promise((resolve, reject) => {
        const child = spawnCodexAppServerProcess();
        const rl = readline.createInterface({ input: child.stdout });
        let settled = false;
        let stderr = '';
        let requestTimer;
        const doneResolve = (value) => {
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
        const doneReject = (error) => {
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
            if (stderr.length > 4000) {
                stderr = stderr.slice(-4000);
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
            let msg;
            try {
                msg = JSON.parse(trimmed);
            }
            catch {
                return;
            }
            if (msg.id !== CODEX_RATE_LIMITS_REQUEST_ID) {
                return;
            }
            if (msg.error) {
                doneReject(new Error(`account/rateLimits/read failed: ${msg.error?.message ?? 'Unknown error'}`));
                return;
            }
            doneResolve((msg.result ?? {}));
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
        const send = (payload) => {
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
        return (0, child_process_1.spawn)('cmd.exe', ['/d', '/s', '/c', 'codex app-server --listen stdio://'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
    }
    return (0, child_process_1.spawn)('codex', ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
}
function pickCodexSnapshot(result) {
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
function mapCodexWindow(window) {
    return {
        utilization: window.usedPercent ?? 0,
        resetsAt: unixToIso(window.resetsAt),
    };
}
function unixToIso(ts) {
    if (!ts) {
        return '';
    }
    const ms = ts > 9999999999 ? ts : ts * 1000;
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
                    const d = JSON.parse(line);
                    if (d.type === 'event_msg' && d.payload?.type === 'token_count' && d.payload?.rate_limits) {
                        rateLimits = d.payload.rate_limits;
                    }
                }
                catch {
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
                utilization: rateLimits.primary?.used_percent ?? 0,
                resetsAt: toIso(rateLimits.primary?.resets_at),
            },
            sevenDay: {
                utilization: rateLimits.secondary?.used_percent ?? 0,
                resetsAt: toIso(rateLimits.secondary?.resets_at),
            },
        };
    }
    catch (e) {
        return { fiveHour: null, sevenDay: null, error: String(e.message) };
    }
}
function findJsonlFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) {
        return results;
    }
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(p);
            }
            else if (entry.name.endsWith('.jsonl')) {
                results.push(p);
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
    return String(error?.message ?? error);
}
function formatUsageErrorDetail(provider, errorText) {
    const text = String(errorText || '').toLowerCase();
    if (provider === 'claude') {
        if (text.includes('token_expired') ||
            text.includes('token has expired') ||
            text.includes('invalid_grant')) {
            return 'CLAUDE CLI RELOGIN REQUIRED (run: claude setup-token)';
        }
        if (text.includes('refresh token missing') ||
            text.includes('missing claudeaioauth') ||
            text.includes('missing claude access token') ||
            text.includes('.credentials.json') ||
            (text.includes('enoent') && text.includes('no such file'))) {
            return 'CLAUDE CLI LOGIN REQUIRED (run: claude setup-token)';
        }
        if (text.includes('timed out') || text.includes('timeout')) {
            return 'CLAUDE API TIMEOUT';
        }
        return 'CLAUDE USAGE UNAVAILABLE';
    }
    if (text.includes('authentication') ||
        text.includes('unauthorized') ||
        text.includes('401') ||
        text.includes('login required') ||
        text.includes('not logged in')) {
        return 'CODEX CLI LOGIN REQUIRED (run: codex login)';
    }
    if (text.includes('failed to start codex app-server') &&
        (text.includes('enoent') || text.includes('not recognized') || text.includes('cannot find'))) {
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
            res.on('data', (c) => {
                raw += c;
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    const status = res.statusCode ?? 0;
                    let message = `HTTP ${status}`;
                    try {
                        const errBody = JSON.parse(raw);
                        if (errBody?.error?.message) {
                            message = `HTTP ${status}: ${errBody.error.message}`;
                        }
                        else if (raw) {
                            message = `HTTP ${status}: ${raw}`;
                        }
                    }
                    catch {
                        if (raw) {
                            message = `HTTP ${status}: ${raw}`;
                        }
                    }
                    reject(new HttpStatusError(status, message, raw));
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(8000, () => {
            req.destroy(new Error('Request timed out'));
        });
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}
function deactivate() {
    clearInterval(timer);
}
