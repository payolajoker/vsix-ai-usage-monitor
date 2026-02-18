import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as path from 'path';

const HOME = os.homedir();

interface UsageResult {
  utilization: number;
  resetsAt: string;
}

interface AgentUsage {
  fiveHour: UsageResult | null;
  sevenDay: UsageResult | null;
  error?: string;
}

let claudeBar: vscode.StatusBarItem;
let codexBar: vscode.StatusBarItem;
let timer: NodeJS.Timeout;

export function activate(context: vscode.ExtensionContext) {
  claudeBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  codexBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);

  claudeBar.show();
  codexBar.show();

  context.subscriptions.push(claudeBar, codexBar);

  doRefresh();
  timer = setInterval(doRefresh, 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

async function doRefresh() {
  const [claude, codex] = await Promise.all([getClaudeUsage(), getCodexUsage()]);
  renderBar(claudeBar, 'Claude', claude, '#f0956a');
  renderBar(codexBar, 'Codex', codex, '#79c0ff');
}

function toPercent(utilization: number): number {
  const raw = utilization <= 1 ? utilization * 100 : utilization;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function renderBar(bar: vscode.StatusBarItem, name: string, data: AgentUsage, color: string) {
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

function formatReset(iso: string): string {
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

// Claude usage
async function getClaudeUsage(): Promise<AgentUsage> {
  try {
    const credPath = path.join(HOME, '.claude', '.credentials.json');
    const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const token: string = cred.claudeAiOauth.accessToken;

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
  } catch (e: any) {
    return { fiveHour: null, sevenDay: null, error: String(e.message) };
  }
}

// Codex usage
async function getCodexUsage(): Promise<AgentUsage> {
  try {
    const sessionsDir = path.join(HOME, '.codex', 'sessions');
    const files = findJsonlFiles(sessionsDir);
    if (files.length === 0) {
      return { fiveHour: null, sevenDay: null, error: 'No session files found' };
    }

    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    let rateLimits: any = null;
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

    const toIso = (ts: number) => (ts ? new Date(ts * 1000).toISOString() : '');
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
  } catch (e: any) {
    return { fiveHour: null, sevenDay: null, error: String(e.message) };
  }
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(p);
      }
    }
  };

  walk(dir);
  return results;
}

function httpsGet(hostname: string, urlPath: string, headers: Record<string, string>): Promise<any> {
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
          } catch {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
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

export function deactivate() {
  clearInterval(timer);
}
