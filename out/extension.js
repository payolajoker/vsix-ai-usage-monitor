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
function activate(context) {
    usageBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    usageBar.show();
    context.subscriptions.push(usageBar);
    doRefresh();
    timer = setInterval(doRefresh, 60000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
async function doRefresh() {
    const [claude, codex] = await Promise.all([(0, provider_adapter_1.getClaudeUsage)(), (0, provider_adapter_1.getCodexUsage)()]);
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
function deactivate() {
    clearInterval(timer);
}
