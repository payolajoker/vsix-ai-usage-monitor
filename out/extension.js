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
const HOME = os.homedir();
let claudeBar;
let codexBar;
let timer;
function activate(context) {
    claudeBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    codexBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    claudeBar.show();
    codexBar.show();
    context.subscriptions.push(claudeBar, codexBar);
    doRefresh();
    timer = setInterval(doRefresh, 60000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
async function doRefresh() {
    const [claude, codex] = await Promise.all([getClaudeUsage(), getCodexUsage()]);
    renderBar(claudeBar, 'Claude', claude, '#f0956a');
    renderBar(codexBar, 'Codex', codex, '#79c0ff');
}
function toPercent(utilization) {
    const raw = utilization <= 1 ? utilization * 100 : utilization;
    return Math.max(0, Math.min(100, Math.round(raw)));
}
function renderBar(bar, name, data, color) {
    if (data.error || !data.fiveHour) {
        bar.text = `$(warning) ${name[0]}`;
        bar.color = '#6e7681';
        bar.tooltip = `${name}: ${data.error ?? 'No data available'}`;
        return;
    }
    const used5h = toPercent(data.fiveHour.utilization);
    const reset5h = formatReset(data.fiveHour.resetsAt);
    bar.text = `$(circle-filled) ${used5h}%${reset5h ? '  ' + reset5h : ''}`;
    bar.color = used5h >= 85 ? '#f85149' : used5h >= 70 ? '#d29922' : color;
    const tip = new vscode.MarkdownString();
    tip.isTrusted = true;
    tip.appendMarkdown(`**${name}**\n\n`);
    tip.appendMarkdown(`| | Used | Resets In |\n|---|---|---|\n`);
    tip.appendMarkdown(`| 5-Hour Session | **${used5h}%** | ${reset5h || '--'} |\n`);
    if (data.sevenDay) {
        const used7d = toPercent(data.sevenDay.utilization);
        const reset7d = formatReset(data.sevenDay.resetsAt);
        tip.appendMarkdown(`| 7-Day Weekly | **${used7d}%** | ${reset7d || '--'} |\n`);
    }
    bar.tooltip = tip;
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
    try {
        const credPath = path.join(HOME, '.claude', '.credentials.json');
        const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        const token = cred.claudeAiOauth.accessToken;
        const data = await httpsGet('api.anthropic.com', '/api/oauth/usage', {
            Authorization: `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
        });
        return {
            fiveHour: data.five_hour
                ? { utilization: data.five_hour.utilization ?? 0, resetsAt: data.five_hour.resets_at ?? '' }
                : null,
            sevenDay: data.seven_day
                ? { utilization: data.seven_day.utilization ?? 0, resetsAt: data.seven_day.resets_at ?? '' }
                : null,
        };
    }
    catch (e) {
        return { fiveHour: null, sevenDay: null, error: String(e.message) };
    }
}
// Codex usage
async function getCodexUsage() {
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
function httpsGet(hostname, urlPath, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request({ hostname, path: urlPath, method: 'GET', headers }, (res) => {
            let raw = '';
            res.on('data', (c) => {
                raw += c;
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    try {
                        const errBody = JSON.parse(raw);
                        reject(new Error(`HTTP ${res.statusCode}: ${errBody.error?.message ?? raw}`));
                    }
                    catch {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
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
        req.end();
    });
}
function deactivate() {
    clearInterval(timer);
}
