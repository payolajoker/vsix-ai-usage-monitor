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
const provider_adapter_1 = require("./provider-adapter");
let usageBar;
let timer;
const DEFAULT_PROVIDERS = ['claude', 'codex', 'copilot'];
const DEFAULT_PROVIDER_MARKERS = {
    claude: '🟠',
    codex: '🔵',
    copilot: '🟩',
};
function activate(context) {
    usageBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    usageBar.show();
    context.subscriptions.push(usageBar);
    doRefresh();
    timer = setInterval(doRefresh, 60000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
async function doRefresh() {
    const displayConfig = getDisplayConfig();
    const copilotConfig = getCopilotConfig();
    const enabledProviders = getEnabledProviders();
    if (enabledProviders.length === 0) {
        renderNoProvidersBar(usageBar, displayConfig);
        return;
    }
    const providers = await Promise.all(enabledProviders.map(async (key) => {
        if (key === 'claude') {
            return {
                key,
                name: 'Claude',
                label: 'C',
                scale: 'ratio',
                data: await (0, provider_adapter_1.getClaudeUsage)(),
            };
        }
        if (key === 'copilot') {
            return {
                key,
                name: 'Copilot',
                label: 'G',
                scale: 'percent',
                data: await (0, provider_adapter_1.getCopilotUsage)(copilotConfig),
            };
        }
        return {
            key,
            name: 'Codex',
            label: 'O',
            scale: 'percent',
            data: await (0, provider_adapter_1.getCodexUsage)(),
        };
    }));
    renderCombinedBar(usageBar, providers, displayConfig);
}
function getCopilotConfig() {
    const config = vscode.workspace.getConfiguration('aiUsageMonitor');
    const lookbackDays = Math.max(1, Math.min(365, Math.round(Number(config.get('copilotLookbackDays', 30)))));
    const includedCredits = Math.max(1, Number(config.get('copilotIncludedCredits', 1000)));
    const autoModel = String(config.get('copilotAutoModel', 'gpt-5.3-codex') ?? 'gpt-5.3-codex')
        .trim()
        .toLowerCase();
    return {
        lookbackDays,
        includedCredits,
        autoModel,
    };
}
function getDisplayConfig() {
    const config = vscode.workspace.getConfiguration('aiUsageMonitor');
    const enableThresholdColors = config.get('enableThresholdColors', true);
    const showProviderLetter = config.get('showProviderLetter', true);
    const weeklyExhaustedDisplay = normalizeWeeklyExhaustedDisplay(config.get('weeklyExhaustedDisplay', 'percent'));
    const markerConfig = config.get('providerMarkers', {});
    const providerMarkers = {
        claude: normalizeMarker(markerConfig?.claude, DEFAULT_PROVIDER_MARKERS.claude),
        codex: normalizeMarker(markerConfig?.codex, DEFAULT_PROVIDER_MARKERS.codex),
        copilot: normalizeMarker(markerConfig?.copilot, DEFAULT_PROVIDER_MARKERS.copilot),
    };
    const warningThreshold = clampPercent(config.get('warningThreshold', 70));
    const criticalThreshold = Math.max(warningThreshold, clampPercent(config.get('criticalThreshold', 85)));
    const colorConfig = config.get('statusBarColors', {});
    const statusColors = {
        disabled: normalizeColor(colorConfig?.disabled, '#6e7681'),
        warning: normalizeColor(colorConfig?.warning, '#d29922'),
        critical: normalizeColor(colorConfig?.critical, '#f85149'),
    };
    return {
        enableThresholdColors,
        showProviderLetter,
        providerMarkers,
        weeklyExhaustedDisplay,
        warningThreshold,
        criticalThreshold,
        statusColors,
    };
}
function normalizeWeeklyExhaustedDisplay(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    return normalized === 'remainingdays' ? 'remainingDays' : 'percent';
}
function normalizeMarker(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function clampPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(numeric)));
}
function normalizeColor(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function getEnabledProviders() {
    const config = vscode.workspace.getConfiguration('aiUsageMonitor');
    const configuredProviders = config.get('enabledProviders');
    if (!configuredProviders) {
        return [...DEFAULT_PROVIDERS];
    }
    return normalizeProviderList(configuredProviders);
}
function normalizeProviderList(input) {
    const enabled = [];
    for (const token of input) {
        const normalized = normalizeProviderToken(String(token).trim().toLowerCase());
        if (normalized && !enabled.includes(normalized)) {
            enabled.push(normalized);
        }
    }
    return enabled;
}
function normalizeProviderToken(token) {
    if (token === 'claude' || token === 'anthropic' || token === 'c') {
        return 'claude';
    }
    if (token === 'codex' || token === 'openai' || token === 'o') {
        return 'codex';
    }
    if (token === 'copilot' ||
        token === 'github' ||
        token === 'ghcp' ||
        token === 'g') {
        return 'copilot';
    }
    return null;
}
function toPercent(utilization, scale) {
    const raw = scale === 'ratio' && utilization <= 1 ? utilization * 100 : utilization;
    return Math.max(0, Math.min(100, Math.round(raw)));
}
function renderNoProvidersBar(bar, display) {
    bar.text = 'AI usage disabled';
    bar.color = display.statusColors.disabled;
    bar.tooltip =
        'No providers are enabled. Configure aiUsageMonitor.enabledProviders.';
}
function renderCombinedBar(bar, providers, display) {
    bar.text = providers
        .map((provider) => formatSegment(provider, display))
        .join('   ');
    const usable = providers
        .map((provider) => getAlertPercent(provider.data, provider.scale))
        .filter((v) => typeof v === 'number');
    if (usable.length === 0) {
        bar.color = display.statusColors.disabled;
    }
    else if (!display.enableThresholdColors) {
        bar.color = undefined;
    }
    else {
        const maxUsed = Math.max(...usable);
        bar.color =
            maxUsed >= display.criticalThreshold
                ? display.statusColors.critical
                : maxUsed >= display.warningThreshold
                    ? display.statusColors.warning
                    : undefined;
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
function getFiveHourPercent(data, scale) {
    if (data.error || !data.fiveHour) {
        return null;
    }
    return toPercent(data.fiveHour.utilization, scale);
}
function getAlertPercent(data, scale) {
    if (data.error) {
        return null;
    }
    if (isWeeklyExhausted(data, scale)) {
        return 100;
    }
    return getFiveHourPercent(data, scale);
}
function formatSegment(provider, display) {
    const prefix = formatProviderPrefix(provider, display);
    const { data, scale } = provider;
    if (data.error || !data.fiveHour) {
        return `${prefix} --`;
    }
    if (isWeeklyExhausted(data, scale)) {
        if (display.weeklyExhaustedDisplay === 'remainingDays') {
            const daysLeft = formatDaysRemaining(data.sevenDay?.resetsAt ?? '');
            return `${prefix} ${daysLeft}`;
        }
        return `${prefix} 100%`;
    }
    const used5h = toPercent(data.fiveHour.utilization, scale);
    const reset5h = formatReset(data.fiveHour.resetsAt);
    const showReset = !data.meta?.hideReset && Boolean(reset5h);
    const segmentSuffix = data.meta?.segmentSuffix
        ? ` ${data.meta.segmentSuffix}`
        : '';
    return `${prefix} ${used5h}%${showReset ? ` ${reset5h}` : ''}${segmentSuffix}`;
}
function formatDaysRemaining(iso) {
    if (!iso) {
        return 'soon';
    }
    try {
        const diffMs = Math.max(0, new Date(iso).getTime() - Date.now());
        const dayMs = 24 * 60 * 60 * 1000;
        const days = Math.max(1, Math.ceil(diffMs / dayMs));
        return `${days}d`;
    }
    catch {
        return 'soon';
    }
}
function formatProviderPrefix(provider, display) {
    const marker = display.providerMarkers[provider.key] ??
        DEFAULT_PROVIDER_MARKERS[provider.key];
    return display.showProviderLetter ? `${marker} ${provider.label}` : marker;
}
function isWeeklyExhausted(data, scale) {
    if (!data.sevenDay) {
        return false;
    }
    return toPercent(data.sevenDay.utilization, scale) >= 100;
}
function appendUsageTooltip(tip, name, data, scale) {
    tip.appendMarkdown(`**${name}**\n\n`);
    if (data.error || !data.fiveHour) {
        tip.appendMarkdown(`- ${data.error ?? 'No data available'}\n`);
        return;
    }
    if (data.meta?.compactTooltip) {
        for (const note of data.meta.tooltipNotes ?? []) {
            tip.appendMarkdown(`- ${note}\n`);
        }
        return;
    }
    tip.appendMarkdown(`| | Used | Resets In |\n|---|---|---|\n`);
    if (isWeeklyExhausted(data, scale) && data.sevenDay) {
        const used7d = toPercent(data.sevenDay.utilization, scale);
        const reset7d = formatReset(data.sevenDay.resetsAt);
        tip.appendMarkdown(`| 7-Day Weekly | **${used7d}%** | ${reset7d || '--'} |\n`);
        tip.appendMarkdown(`\n- Weekly cap reached; short-session reset is unavailable.\n`);
        return;
    }
    const used5h = toPercent(data.fiveHour.utilization, scale);
    const reset5h = formatReset(data.fiveHour.resetsAt);
    const primaryLabel = data.meta?.primaryLabel || '5-Hour Session';
    tip.appendMarkdown(`| ${primaryLabel} | **${used5h}%** | ${reset5h || '--'} |\n`);
    if (data.sevenDay) {
        const used7d = toPercent(data.sevenDay.utilization, scale);
        const reset7d = formatReset(data.sevenDay.resetsAt);
        tip.appendMarkdown(`| 7-Day Weekly | **${used7d}%** | ${reset7d || '--'} |\n`);
    }
    if (data.meta?.tooltipNotes?.length) {
        tip.appendMarkdown('\n');
        for (const note of data.meta.tooltipNotes) {
            tip.appendMarkdown(`- ${note}\n`);
        }
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
function deactivate() {
    clearInterval(timer);
}
