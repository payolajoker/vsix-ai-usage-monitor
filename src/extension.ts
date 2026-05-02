import * as vscode from 'vscode';
import { AgentUsage, getClaudeUsage, getCodexUsage } from './provider-adapter';

let usageBar: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval>;

type ProviderKey = 'claude' | 'codex';
type UsageScale = 'ratio' | 'percent';

interface ProviderViewModel {
  key: ProviderKey;
  name: string;
  emoji: string;
  label: string;
  scale: UsageScale;
  data: AgentUsage;
}

const DEFAULT_PROVIDERS: ProviderKey[] = ['claude', 'codex'];

export function activate(context: vscode.ExtensionContext) {
  usageBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    1000,
  );

  usageBar.show();

  context.subscriptions.push(usageBar);

  doRefresh();
  timer = setInterval(doRefresh, 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

async function doRefresh() {
  const enabledProviders = getEnabledProviders();
  if (enabledProviders.length === 0) {
    renderNoProvidersBar(usageBar);
    return;
  }

  const providers = await Promise.all(
    enabledProviders.map(async (key): Promise<ProviderViewModel> => {
      if (key === 'claude') {
        return {
          key,
          name: 'Claude',
          emoji: '🟠',
          label: 'C',
          scale: 'ratio',
          data: await getClaudeUsage(),
        };
      }

      return {
        key,
        name: 'Codex',
        emoji: '🔵',
        label: 'O',
        scale: 'percent',
        data: await getCodexUsage(),
      };
    }),
  );

  renderCombinedBar(usageBar, providers);
}

function getEnabledProviders(): ProviderKey[] {
  const raw = readEnv('AI_USAGE_PROVIDERS');
  if (!raw || !raw.trim()) {
    return [...DEFAULT_PROVIDERS];
  }

  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.includes('none') || tokens.includes('off')) {
    return [];
  }

  const enabled: ProviderKey[] = [];
  for (const token of tokens) {
    const normalized = normalizeProviderToken(token);
    if (normalized && !enabled.includes(normalized)) {
      enabled.push(normalized);
    }
  }

  return enabled.length > 0 ? enabled : [...DEFAULT_PROVIDERS];
}

function readEnv(name: string): string | undefined {
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.[name];
}

function normalizeProviderToken(token: string): ProviderKey | null {
  if (token === 'claude' || token === 'anthropic' || token === 'c') {
    return 'claude';
  }
  if (token === 'codex' || token === 'openai' || token === 'o') {
    return 'codex';
  }
  return null;
}

function toPercent(utilization: number, scale: 'ratio' | 'percent'): number {
  const raw =
    scale === 'ratio' && utilization <= 1 ? utilization * 100 : utilization;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function renderNoProvidersBar(bar: vscode.StatusBarItem) {
  bar.text = 'AI usage disabled';
  bar.color = '#6e7681';
  bar.tooltip =
    'No providers are enabled. Set AI_USAGE_PROVIDERS to codex, claude, or both (comma/space separated).';
}

function renderCombinedBar(
  bar: vscode.StatusBarItem,
  providers: ProviderViewModel[],
) {
  bar.text = providers
    .map((provider) =>
      formatSegment(
        provider.emoji,
        provider.label,
        provider.data,
        provider.scale,
      ),
    )
    .join('  |  ');

  const usable = providers
    .map((provider) => getAlertPercent(provider.data, provider.scale))
    .filter((v): v is number => typeof v === 'number');
  if (usable.length === 0) {
    bar.color = '#6e7681';
  } else {
    const maxUsed = Math.max(...usable);
    bar.color =
      maxUsed >= 85 ? '#f85149' : maxUsed >= 70 ? '#d29922' : undefined;
  }

  const tip = new vscode.MarkdownString();
  tip.isTrusted = true;
  providers.forEach((provider, index) => {
    if (index > 0) {
      tip.appendMarkdown('\n');
    }
    appendUsageTooltip(tip, provider.name, provider.data, provider.scale);
  });
  bar.tooltip = tip;
}

function getFiveHourPercent(
  data: AgentUsage,
  scale: UsageScale,
): number | null {
  if (data.error || !data.fiveHour) {
    return null;
  }
  return toPercent(data.fiveHour.utilization, scale);
}

function getAlertPercent(data: AgentUsage, scale: UsageScale): number | null {
  if (data.error) {
    return null;
  }
  if (isWeeklyExhausted(data, scale)) {
    return 100;
  }
  return getFiveHourPercent(data, scale);
}

function formatSegment(
  emoji: string,
  label: string,
  data: AgentUsage,
  scale: UsageScale,
): string {
  if (data.error || !data.fiveHour) {
    return `${emoji} ${label} --`;
  }

  if (isWeeklyExhausted(data, scale)) {
    return `${emoji} ${label} 100%`;
  }

  const used5h = toPercent(data.fiveHour.utilization, scale);
  const reset5h = formatReset(data.fiveHour.resetsAt);
  return `${emoji} ${label} ${used5h}%${reset5h ? ` ${reset5h}` : ''}`;
}

function isWeeklyExhausted(data: AgentUsage, scale: UsageScale): boolean {
  if (!data.sevenDay) {
    return false;
  }
  return toPercent(data.sevenDay.utilization, scale) >= 100;
}

function appendUsageTooltip(
  tip: vscode.MarkdownString,
  name: string,
  data: AgentUsage,
  scale: UsageScale,
) {
  tip.appendMarkdown(`**${name}**\n\n`);
  if (data.error || !data.fiveHour) {
    tip.appendMarkdown(`- ${data.error ?? 'No data available'}\n`);
    return;
  }

  tip.appendMarkdown(`| | Used | Resets In |\n|---|---|---|\n`);
  if (isWeeklyExhausted(data, scale) && data.sevenDay) {
    const used7d = toPercent(data.sevenDay.utilization, scale);
    const reset7d = formatReset(data.sevenDay.resetsAt);
    tip.appendMarkdown(
      `| 7-Day Weekly | **${used7d}%** | ${reset7d || '--'} |\n`,
    );
    tip.appendMarkdown(
      `\n- Weekly cap reached; short-session reset is unavailable.\n`,
    );
    return;
  }

  const used5h = toPercent(data.fiveHour.utilization, scale);
  const reset5h = formatReset(data.fiveHour.resetsAt);
  tip.appendMarkdown(
    `| 5-Hour Session | **${used5h}%** | ${reset5h || '--'} |\n`,
  );
  if (data.sevenDay) {
    const used7d = toPercent(data.sevenDay.utilization, scale);
    const reset7d = formatReset(data.sevenDay.resetsAt);
    tip.appendMarkdown(
      `| 7-Day Weekly | **${used7d}%** | ${reset7d || '--'} |\n`,
    );
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
