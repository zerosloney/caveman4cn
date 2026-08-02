// caveman-plugin.ts — Cline SDK Plugin for caveman mode
//
// Implements lifecycle hooks for caveman mode:
// - session_start: Activate caveman mode, inject rules
// - before_agent_start: Mode tracking, command parsing, per-turn reinforcement
// - tool_call_before: Block dangerous operations
// - tool_call_after: Track token usage
// - run_end: Output quality check, persist stats

import type { AgentPlugin } from '@cline/sdk';
import * as fs from 'fs';
import * as path from 'path';
import {
  VALID_MODES,
  getDefaultMode,
  isCavemanActive,
  getCurrentMode,
  activateMode,
  deactivateMode,
  getAgentFlagPath,
  getAgentPrevFlagPath,
  readFlag,
  safeWriteFlag,
} from './caveman-config';
import {
  recordUsage,
  computeStats,
  formatStats,
  writeLifetimeBadge,
  writeSessionSnapshot,
  resetSession,
} from './caveman-stats';

const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);

const DANGEROUS_PATTERNS: Record<string, RegExp[]> = {
  Bash: [
    /rm\s+-rf?\s+\//, /rm\s+-rf?\s+~[/\s]/, /rm\s+-rf?\s+\*/,
    /rmdir\s+\/s/i, /del\s+\/[sf]/i,
    /Remove-Item[^\n]*-Recurse[^\n]*-Force/i, /rd\s+\/s/i,
    /mkfs\./i, /fdisk/i, /dd\s+if=\/dev\/zero/i, /format\s+[a-z]:/i,
    /chmod\s+-R\s+777/, /chmod\s+777\s+\//,
    /:\(\)\s*{\s*:\|:\&\s*}\s*;\s*:/,
    /curl[^\n]*\|\s*(sh|bash)/i, /wget[^\n]*\|\s*(sh|bash)/i,
  ],
  Write: [
    /\/etc\/(passwd|shadow|sudoers|group)/, /\/etc\/ssh\//, /\/boot\//, /\/dev\//,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+drivers[\\/]+etc[\\/]+hosts/,
    /~\/\.ssh\//, /~\/\.aws\/(credentials|config)/,
  ],
  Edit: [
    /\/etc\/(passwd|shadow|sudoers|group)/, /\/etc\/ssh\//, /\/boot\//,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+drivers[\\/]+etc[\\/]+hosts/,
    /~\/\.ssh\//, /~\/\.aws\/(credentials|config)/,
  ],
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  'run_shell_command': 'Bash', 'runshellcommand': 'Bash', 'bash': 'Bash',
  'execute': 'Bash', 'terminal': 'Bash',
  'write': 'Write', 'writefile': 'Write', 'multiedit': 'Write', 'edit': 'Edit',
};

function normalizeToolName(toolName: string): string | null {
  if (!toolName) return null;
  const lower = String(toolName).toLowerCase();
  const compact = lower.replace(/_/g, '');
  if (TOOL_NAME_ALIASES[compact]) return TOOL_NAME_ALIASES[compact];
  if (TOOL_NAME_ALIASES[lower]) return TOOL_NAME_ALIASES[lower];
  if (DANGEROUS_PATTERNS[toolName]) return toolName;
  return null;
}

function checkDangerous(toolName: string, toolInput: any): string | null {
  const key = normalizeToolName(toolName);
  if (!key) return null;
  const patterns = DANGEROUS_PATTERNS[key];
  if (!patterns) return null;
  const inputStr = JSON.stringify(toolInput || '');
  for (const pattern of patterns) {
    if (pattern.test(inputStr)) {
      return `Operation blocked by caveman safety hook: dangerous pattern detected.`;
    }
  }
  return null;
}

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

function checkVerbosity(message: string): string | null {
  if (!message) return null;
  const prose = stripCode(message);
  const lines = prose.split('\n');
  const fillerStems = ['sure', 'certain', 'of course', 'happy to', 'i\'?d (suggest|recommend)', 'my pleasure', 'glad to'];
  const fillerCount = fillerStems.reduce((sum, stem) => {
    const regex = new RegExp('\\b' + stem + '\\w*\\b', 'gi');
    const matches = prose.match(regex);
    return sum + (matches ? matches.length : 0);
  }, 0);
  const wordCount = prose.split(/\s+/).filter(Boolean).length;
  const totalLines = lines.filter(Boolean).length;
  if (fillerCount > 3 && wordCount > 100) {
    return `[caveman] ${fillerCount} filler words across ${wordCount} words. Drop filler and pleasantries.`;
  }
  if (wordCount > 300 && totalLines > 20) {
    return `[caveman] Output too long (${wordCount} words, ${totalLines} lines). Compress to bullet points.`;
  }
  return null;
}

function parseSlashCommand(prompt: string): string | null {
  const match = prompt.match(/^\/caveman(?:\s+(\S+))?\s*$/i);
  if (!match) return null;
  const arg = (match[1] || 'full').toLowerCase();
  if (VALID_MODES.includes(arg as any)) return arg;
  return null;
}

function parseNlActivation(prompt: string): string | null {
  const wantsOff =
    /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/.test(prompt) ||
    /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/.test(prompt) ||
    /^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/.test(prompt);
  const isQuestion = /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/.test(prompt);
  if (wantsOff) return 'off';
  if (!isQuestion) {
    if (/\b(activate|enable|start|turn on|use|switch to|want|give me)\b[^.]{0,40}\bcaveman\b/.test(prompt) ||
        /\bcaveman\s+(mode|on)\b/.test(prompt) ||
        /\b(talk|speak|write)\s+(like\s+)?(a\s+)?caveman\b/.test(prompt) ||
        /\b(less|fewer)\s+tokens?\b/.test(prompt) ||
        /\bbe\s+(brief|concise|terse)\b/.test(prompt)) {
      return 'on';
    }
  }
  return null;
}

let blockCount = 0;

function resolveSkillContent(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'skills', 'caveman', 'SKILL.md'),
    path.join(__dirname, '..', '..', '..', 'skills', 'caveman', 'SKILL.md'),
  ];
  for (const c of candidates) {
    try { return fs.readFileSync(c, 'utf-8'); } catch { /* try next */ }
  }
  return '';
}

const FALLBACK_RULES =
  'Caveman mode active. Respond terse like smart caveman — drop articles, ' +
  'filler, pleasantries. Fragments OK. Technical terms exact. Code unchanged.';

// ── Plugin Definition ────────────────────────────────────────────────────

export const cavemanPlugin: AgentPlugin = {
  name: 'caveman',
  manifest: {
    capabilities: ['tools', 'hooks', 'rules'],
  },

  setup(api, ctx) {
    api.registerTool({
      name: 'caveman_stats',
      description: 'Show real token usage and estimated savings for the current session or lifetime.',
      inputSchema: {
        type: 'object',
        properties: {
          lifetime: {
            type: 'boolean',
            description: 'Show lifetime stats instead of session stats',
          },
        },
      },
      execute: async (input) => {
        const lifetime = input?.lifetime || false;
        const stats = computeStats(lifetime);
        writeLifetimeBadge();
        return { content: formatStats(stats) };
      },
    });
  },

  hooks: {
    sessionStart(context) {
      const mode = getDefaultMode();
      const skillContent = resolveSkillContent();
      if (mode !== 'off') {
        activateMode(mode);
        const additionalContext = skillContent
          ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
          : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;
        return { additionalContext };
      }
      return {};
    },

    beforeAgentStart(context) {
      const prompt = context.prompt || '';
      const lowerPrompt = prompt.toLowerCase().replace(/\s+/g, ' ');

      if (/^\/caveman-stats(\s|$)/i.test(prompt.trim())) {
        const lifetime = /\s--(lifetime|all|since)\b/i.test(prompt) || /\s--all\b/.test(prompt);
        const stats = computeStats(lifetime);
        writeLifetimeBadge();
        return { additionalContext: formatStats(stats) };
      }

      let currentMode = getCurrentMode() || getDefaultMode();
      const slashMode = parseSlashCommand(lowerPrompt);

      if (slashMode) {
        if (slashMode === 'off') {
          deactivateMode();
          currentMode = null;
        } else if (INDEPENDENT_MODES.has(slashMode)) {
          const current = getCurrentMode();
          if (current && !INDEPENDENT_MODES.has(current)) {
            safeWriteFlag(getAgentPrevFlagPath(), current);
          }
          activateMode(slashMode);
          currentMode = slashMode;
        } else {
          activateMode(slashMode);
          currentMode = slashMode;
        }
      }

      if (!slashMode) {
        const nlMode = parseNlActivation(lowerPrompt);
        if (nlMode === 'off') {
          deactivateMode();
          currentMode = null;
        } else if (nlMode === 'on') {
          const mode = getDefaultMode();
          if (mode !== 'off') {
            activateMode(mode);
            currentMode = mode;
          }
        }
      }

      if (currentMode && INDEPENDENT_MODES.has(currentMode)) {
        const prev = readFlag(getAgentPrevFlagPath());
        try {
          const prevPath = getAgentPrevFlagPath();
          if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath);
        } catch { /* skip */ }
        if (prev && !INDEPENDENT_MODES.has(prev)) {
          activateMode(prev);
          currentMode = prev;
        } else {
          deactivateMode();
          currentMode = null;
        }
      }

      let additionalContext = '';
      if (currentMode && !INDEPENDENT_MODES.has(currentMode)) {
        additionalContext =
          `CAVEMAN MODE ACTIVE (${currentMode}). ` +
          `Drop articles/filler/pleasantries/hedging. Fragments OK. ` +
          `Code/commits/security: write normal.`;
      }

      return { additionalContext };
    },

    toolCallBefore(context) {
      if (!isCavemanActive()) return {};
      const toolName = context.toolCall?.name || '';
      const toolInput = context.toolCall?.input || {};
      const dangerReason = checkDangerous(toolName, toolInput);
      if (dangerReason) {
        return { decision: 'deny', reason: dangerReason };
      }
      return {};
    },

    toolCallAfter(context) {
      if (context.usage) {
        recordUsage({
          inputTokens: context.usage.inputTokens || 0,
          outputTokens: context.usage.outputTokens || 0,
          cacheReadTokens: context.usage.cacheReadTokens,
          cacheWriteTokens: context.usage.cacheWriteTokens,
          cost: context.usage.cost,
        });
      }
      return {};
    },

    runEnd(context) {
      writeSessionSnapshot();
      writeLifetimeBadge();
      if (!isCavemanActive()) return {};
      const lastMessage = context.result?.text || '';
      const issue = checkVerbosity(lastMessage);
      if (issue) {
        blockCount++;
        if (blockCount >= 3) {
          blockCount = 0;
          return {};
        }
        return { decision: 'block', reason: issue };
      }
      blockCount = 0;
      return {};
    },

    sessionShutdown(context) {
      writeLifetimeBadge();
      resetSession();
      return {};
    },
  },
};

export default cavemanPlugin;

