import * as vscode from 'vscode';
import { AgentUsage, getClaudeUsage, getCodexUsage } from './provider-adapter';

let usageBar: vscode.StatusBarItem;
let timer: NodeJS.Timeout;

export function activate(context: vscode.ExtensionContext) {
  usageBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);

  usageBar.show();

  context.subscriptions.push(usageBar);

  doRefresh();
  timer = setInterval(doRefresh, 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

async function doRefresh() {
  const [claude, codex] = await Promise.all([getClaudeUsage(), getCodexUsage()]);
  renderCombinedBar(usageBar, claude, codex);
}

function toPercent(utilization: number, scale: 'ratio' | 'percent'): number {
  const raw = scale === 'ratio' && utilization <= 1 ? utilization * 100 : utilization;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function renderCombinedBar(bar: vscode.StatusBarItem, claude: AgentUsage, codex: AgentUsage) {
  const claudeSegment = formatSegment('🟠', 'C', claude, 'ratio');
  const codexSegment = formatSegment('🔵', 'O', codex, 'percent');
  bar.text = `${claudeSegment}  |  ${codexSegment}`;

  const claude5h = getFiveHourPercent(claude, 'ratio');
  const codex5h = getFiveHourPercent(codex, 'percent');
  const usable = [claude5h, codex5h].filter((v): v is number => typeof v === 'number');
  if (usable.length === 0) {
    bar.color = '#6e7681';
  } else {
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

function getFiveHourPercent(data: AgentUsage, scale: 'ratio' | 'percent'): number | null {
  if (data.error || !data.fiveHour) {
    return null;
  }
  return toPercent(data.fiveHour.utilization, scale);
}

function formatSegment(
  emoji: string,
  label: string,
  data: AgentUsage,
  scale: 'ratio' | 'percent'
): string {
  if (data.error || !data.fiveHour) {
    return `${emoji} ${label} --`;
  }
  const used5h = toPercent(data.fiveHour.utilization, scale);
  const reset5h = formatReset(data.fiveHour.resetsAt);
  return `${emoji} ${label} ${used5h}%${reset5h ? ` ${reset5h}` : ''}`;
}

function appendUsageTooltip(
  tip: vscode.MarkdownString,
  name: string,
  data: AgentUsage,
  scale: 'ratio' | 'percent'
) {
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

export function deactivate() {
  clearInterval(timer);
}
