// caveman-plugin.ts — Cline SDK Plugin for caveman mode
//
// Implements lifecycle hooks for caveman mode via the @cline/sdk AgentPlugin
// (AgentExtension) contract. The runtime hook bag is `AgentRuntimeHooks`:
//   beforeRun / afterRun / beforeModel / afterModel / beforeTool / afterTool / onEvent
//
// Mapping to the original feature set:
// - setup:                      register caveman_stats tool + always-on rules
// - beforeRun:                  activate default mode, reset per-run session stats
// - beforeModel:                /caveman command parsing, mode tracking, stats injection
// - beforeTool:                 block dangerous operations (skip)
// - afterRun:                   record token usage, persist stats, output quality check
//
// NOTE: the SDK has no sessionStart/sessionShutdown/runEnd hooks. Session scope
// maps to a single run()/continue() boundary, and the output-quality check is
// log-only (the SDK's `stop` control aborts the whole run, which is not the
// desired "please compress" behavior).

import type { AgentPlugin } from '@cline/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  VALID_MODES,
  getDefaultMode,
  isCavemanActive,
  getCurrentMode,
  activateMode,
  deactivateMode,
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

// ESM-safe skill resolution: the plugin is loaded as a `.ts` module with
// `"type": "module"` (no `__dirname`). Resolve relative to this file's URL,
// falling back to cwd-based candidates (bundled-skills layout) on failure.
function resolveSkillContent(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(here, '..', '..', 'skills', 'caveman', 'SKILL.md'),
      path.join(here, '..', '..', '..', 'skills', 'caveman', 'SKILL.md'),
      path.join(process.cwd(), 'skills', 'caveman', 'SKILL.md'),
    ];
    for (const c of candidates) {
      try { return fs.readFileSync(c, 'utf-8'); } catch { /* try next */ }
    }
  } catch { /* import.meta unavailable */ }
  return '';
}

const FALLBACK_RULES =
  'Caveman mode active. Respond terse like smart caveman — drop articles, ' +
  'filler, pleasantries. Fragments OK. Technical terms exact. Code unchanged.';

// `/caveman-stats ...` is intercepted here and the formatted stats are injected
// into the model request as an extra user message (the SDK has no
// `additionalContext` return for beforeModel).
const STATS_COMMAND_RE = /^\/caveman-stats(\s|$)/i;

function statsRequested(prompt: string): boolean {
  return STATS_COMMAND_RE.test(prompt.trim());
}

function statsLifetimeRequested(prompt: string): boolean {
  return /\s--(lifetime|all|since)\b/i.test(prompt) || /\s--all\b/.test(prompt);
}

// ── Plugin Definition ────────────────────────────────────────────────────

export const cavemanPlugin: AgentPlugin = {
  name: 'caveman',
  manifest: {
    capabilities: ['tools', 'hooks', 'rules'],
  },

  setup(api) {
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
        const lifetime = Boolean((input as { lifetime?: boolean } | undefined)?.lifetime);
        const stats = computeStats(lifetime);
        writeLifetimeBadge();
        return { content: formatStats(stats) };
      },
    });

    // Always-on compression rules via the `rules` capability (placed into the
    // runtime system prompt once, instead of per-turn message injection).
    const rules = resolveSkillContent() || FALLBACK_RULES;
    api.registerRule({ id: 'caveman-mode', content: rules });
  },

  hooks: {
    beforeRun() {
      // A run()/continue() boundary is the closest analogue to "session start"
      // in the SDK hook bag. Reset per-run stats and (re)activate the default.
      resetSession();
      const mode = getDefaultMode();
      if (mode !== 'off') {
        activateMode(mode);
      }
      return {};
    },

    beforeModel(context) {
      const request = context.request;
      const messages = request.messages;
      // The user's latest prompt is the tail user message of the model request.
      let prompt = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'user') {
          prompt = msg.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join(' ')
            .trim();
          break;
        }
      }
      const lowerPrompt = prompt.toLowerCase().replace(/\s+/g, ' ');

      if (statsRequested(prompt)) {
        const lifetime = statsLifetimeRequested(prompt);
        const stats = computeStats(lifetime);
        writeLifetimeBadge();
        return {
          messages: [
            ...messages,
            {
              id: `caveman-stats-${Date.now()}`,
              role: 'user' as const,
              content: [{ type: 'text' as const, text: formatStats(stats) }],
              createdAt: Date.now(),
            },
          ],
        };
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

      // Rules are always-on via registerRule (system prompt); no per-turn
      // reinforcement message is needed here.
      return {};
    },

    beforeTool(context) {
      if (!isCavemanActive()) return {};
      // AgentToolCallPart carries the tool name in `toolName`, and the parsed
      // tool input is exposed both on `input` and `toolCall.input`.
      const toolName = context.toolCall?.toolName || context.tool?.name || '';
      const toolInput =
        context.input !== undefined ? context.input : context.toolCall?.input;
      const dangerReason = checkDangerous(toolName, toolInput);
      if (dangerReason) {
        // `skip` blocks only this call (unlike `stop`, which aborts the run).
        return { skip: true, reason: dangerReason };
      }
      return {};
    },

    afterRun(context) {
      // Record the run's token usage once (usage-updated events can fire many
      // times per model call, which would inflate the turn count).
      const usage = context.result?.usage;
      if (usage) {
        recordUsage({
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          cost: usage.totalCost,
        });
      }
      writeSessionSnapshot();
      writeLifetimeBadge();

      if (!isCavemanActive()) return {};
      const lastMessage = context.result?.outputText || '';
      const issue = checkVerbosity(lastMessage);
      if (issue) {
        blockCount++;
        // The SDK cannot re-block a finished run; surface the hint only.
        if (blockCount < 3) console.warn(`[caveman] ${issue}`);
        return {};
      }
      blockCount = 0;
      return {};
    },

    // Token usage is recorded once per run in afterRun; no per-call work needed.
    afterTool() {
      return {};
    },
  },
};

export default cavemanPlugin;

