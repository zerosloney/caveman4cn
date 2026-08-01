// caveman — OMP extension (oh-my-pi build)
//
// Main entry point. Registers event hooks and slash commands to provide
// caveman ultra-compressed communication mode within Oh My Pi.
//
// The `pi` parameter is injected by OMP's extension runner at runtime.
// Type annotations are advisory; the runtime API is defined by
// @oh-my-pi/pi-coding-agent (bundled with OMP, not on npm).

import {
  VALID_MODES,
  getDefaultMode,
  getAgentFlagPath,
  readFlag,
  safeWriteFlag,
  recordModeChange,
  migrateLegacyFiles,
  AGENT_ID,
} from './config';
import {
  computeStats,
  formatStats,
  writeLifetimeBadge,
  writeSessionSnapshot,
  readLifetimeBadge,
  readSessionSnapshot,
} from './stats';

const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);

// ── Minimal inline types ─────────────────────────────────────────────────────
// These mirror the relevant subset of @oh-my-pi/pi-coding-agent's ExtensionAPI
// and event shapes. At runtime OMP provides the real implementations.

interface ExtensionContext {
  ui: {
    notify(msg: string, level: 'info' | 'warn' | 'error'): void;
    setStatus(key: string, text: string): void;
  };
  cwd: string;
}

interface ExtensionCommandContext extends ExtensionContext {
  waitForIdle(): Promise<void>;
}

interface ExtensionAPI {
  setLabel(label: string): void;
  on(event: string, handler: (...args: any[]) => any): void;
  sendMessage(
    content: string,
    options?: { deliverAs?: 'steer' | 'followUp' | 'nextTurn' },
  ): void;
  registerCommand(
    name: string,
    def: {
      description: string;
      argumentHint?: string;
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    },
  ): void;
  appendEntry(customType: string, data: unknown): void;
}

// ── Mode flag helpers ─────────────────────────────────────────────────────────

function getActiveMode(): string | null {
  return readFlag(getAgentFlagPath());
}

function setActiveMode(mode: string): void {
  const flagPath = getAgentFlagPath();
  safeWriteFlag(flagPath, mode);
  recordModeChange(mode);
}

function clearActiveMode(): void {
  const flagPath = getAgentFlagPath();
  const prev = readFlag(flagPath);
  if (prev) {
    safeWriteFlag(flagPath, 'off');
    recordModeChange('off');
  }
}

// ── Caveman rules injection ──────────────────────────────────────────────────

const CAVEMAN_RULES: Record<string, string> = {
  lite: 'Caveman lite: respond concisely. Drop filler words (just/really/basically). Keep full sentences. Professional but compact.',
  full: 'Caveman full: respond terse like smart caveman — drop articles (a/an/the), filler, pleasantries, hedging. Fragments OK. Short synonyms. Technical terms exact. Code unchanged. Pattern: [thing] [action] [reason]. [next step].',
  ultra: 'Caveman ultra: maximum compression. Omit conjunctions when causal still clear. One word when one word suffices. State each fact once. Technical terms, code, errors exact. No prose abbreviations.',
  'wenyan-lite': 'Caveman wenyan-lite: semi-classical Chinese. Drop filler/hedging but retain grammatical structure. Classical register.',
  wenyan: 'Caveman wenyan: full classical Chinese. 80-90% character reduction. Classical sentence structure, verb-first, classical particles (之/乃/為/其).',
  'wenyan-full': 'Caveman wenyan: full classical Chinese. 80-90% character reduction. Classical sentence structure, verb-first, classical particles (之/乃/為/其).',
  'wenyan-ultra': 'Caveman wenyan-ultra: maximum classical Chinese compression. Minimalist, maximal compression.',
};

function getCavemanInstruction(mode: string): string | null {
  if (mode === 'off') return null;
  if (INDEPENDENT_MODES.has(mode)) return null;
  return CAVEMAN_RULES[mode] || CAVEMAN_RULES.full;
}

// ── NL activation patterns ───────────────────────────────────────────────────

function matchNlActivation(text: string): string | null {
  // Deactivation
  if (/^(stop|cancel|disable|exit|deactivate|end)\s+(caveman|caveman\s+mode)/i.test(text)) return 'off';
  if (/^(normal|regular|default)\s+mode/i.test(text)) return 'off';

  // Activation phrases
  if (/^(talk|speak|respond)\s+(like\s+)?(caveman|concise|terse|brief)/i.test(text)) return 'full';
  if (/\b(less\s+token|be\s+concise|be\s+brief|be\s+terse|shorter|compact)\b/i.test(text)) return 'full';
  if (/\b(caveman|activate\s+caveman)\b/i.test(text)) return 'full';

  return null;
}

// ── Slash command parsing ────────────────────────────────────────────────────

function parseSlashCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (!cmd) return null;
  return { command: cmd, args: parts.slice(1).join(' ') };
}

function parseCavemanModeArg(args: string): string | null {
  const a = args.trim().toLowerCase();
  if (!a) return null;
  if ((VALID_MODES as readonly string[]).includes(a)) return a;
  return null;
}

// ── Status line update ───────────────────────────────────────────────────────

function updateStatusLine(ctx: { ui: { setStatus: (key: string, text: string) => void } }): void {
  const mode = getActiveMode() || 'off';
  const lifetime = readLifetimeBadge();
  const parts = [`⛏ [${mode}]`];
  if (lifetime > 0) {
    parts.push(`💰 ${fmtShort(lifetime)}`);
  }
  ctx.ui.setStatus('caveman', parts.join(' '));
}

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Extension factory ────────────────────────────────────────────────────────

export default function cavemanExtension(pi: ExtensionAPI): void {
  pi.setLabel('Caveman');

  // ─── Session start ────────────────────────────────────────────────────────
  pi.on('session_start', async (_event: unknown, ctx: ExtensionContext) => {
    migrateLegacyFiles();

    const mode = getActiveMode() || getDefaultMode();
    if (mode !== 'off' && !INDEPENDENT_MODES.has(mode)) {
      // Inject caveman rules into the system context
      const instruction = getCavemanInstruction(mode);
      if (instruction) {
        pi.appendEntry('caveman_state', {
          mode,
          instruction,
          timestamp: Date.now(),
        });
      }
    }
    updateStatusLine(ctx);
  });

  // ─── User input ───────────────────────────────────────────────────────────
  pi.on('input', async (event: unknown) => {
    const ev = event as { message?: { content?: Array<{ text?: string }> } };
    if (!ev.message?.content?.[0]?.text) return;
    const text = ev.message.content[0].text;

    const cmd = parseSlashCommand(text);
    if (cmd) {
      switch (cmd.command) {
        case 'caveman': {
          const mode = parseCavemanModeArg(cmd.args) || 'full';
          setActiveMode(mode);
          const instruction = getCavemanInstruction(mode);
          if (instruction) {
            pi.sendMessage(
              `[System: Caveman mode set to "${mode}". ${instruction}]`,
              { deliverAs: 'steer' },
            );
          }
          break;
        }
        case 'caveman-stats': {
          const args = cmd.args;
          const lifetime = /\b--lifetime\b/i.test(args) || /\b-l\b/i.test(args);
          const stats = computeStats({ lifetime });
          pi.sendMessage(formatStats(stats), { deliverAs: 'steer' });
          break;
        }
        case 'caveman-commit': {
          setActiveMode('commit');
          pi.sendMessage(
            'Caveman commit mode active. Generate conventional commit message (≤50 char subject, body only for non-obvious why).',
            { deliverAs: 'steer' },
          );
          break;
        }
        case 'caveman-review': {
          setActiveMode('review');
          pi.sendMessage(
            'Caveman review mode active. One-line review comments: L<line>: <emoji> <severity>: <problem>. <fix>.',
            { deliverAs: 'steer' },
          );
          break;
        }
        case 'caveman-compress': {
          if (!cmd.args) {
            pi.sendMessage('Usage: /caveman-compress <filepath>', {
              deliverAs: 'steer',
            });
            break;
          }
          setActiveMode('compress');
          pi.sendMessage(
            `Caveman compress mode active. Compress ${cmd.args} to caveman format. Preserve all code blocks, URLs, paths verbatim. Backup original as ${cmd.args}.original.md.`,
            { deliverAs: 'steer' },
          );
          break;
        }
        case 'caveman-help': {
          pi.sendMessage(formatHelpCard(getActiveMode()), {
            deliverAs: 'steer',
          });
          break;
        }
        case 'caveman-statusline': {
          const mode = getActiveMode() || 'off';
          const lifetime = readLifetimeBadge();
          const parts = [`⛏ [${mode}]`];
          if (lifetime > 0) parts.push(`💰 ${fmtShort(lifetime)}`);
          pi.sendMessage(`Caveman status: ${parts.join(' ')}`, {
            deliverAs: 'steer',
          });
          break;
        }
      }
    } else {
      // NL activation (non-slash-command)
      const nlMode = matchNlActivation(text);
      if (nlMode) {
        if (nlMode === 'off') {
          clearActiveMode();
          pi.sendMessage(
            '[System: Caveman mode deactivated. Return to normal communication style.]',
            { deliverAs: 'steer' },
          );
        } else {
          setActiveMode(nlMode);
          const instruction = getCavemanInstruction(nlMode);
          if (instruction) {
            pi.sendMessage(
              `[System: Caveman mode activated. ${instruction}]`,
              { deliverAs: 'steer' },
            );
          }
        }
      }
    }
  });

  // ─── Context injection ────────────────────────────────────────────────────
  // Injects caveman rules into the LLM context on every turn so the model
  // never forgets the compression style even after compaction.
  pi.on('context', async (_event: unknown) => {
    const mode = getActiveMode();
    if (!mode || mode === 'off' || INDEPENDENT_MODES.has(mode)) return;

    const instruction = getCavemanInstruction(mode);
    if (!instruction) return;

    // Return a custom_message that keeps the instruction near the current turn
    pi.appendEntry('caveman_context', {
      mode,
      instruction,
      timestamp: Date.now(),
    });
  });

  // ─── Session stop ─────────────────────────────────────────────────────────
  pi.on('session_stop', async () => {
    const mode = getActiveMode();
    if (!mode || mode === 'off') return;

    // Record near-real-time stats snapshot for the statusline
    try {
      const stats = computeStats({ lifetime: false });
      if (stats.found) {
        writeSessionSnapshot(stats);
        writeLifetimeBadge(stats);
      }
    } catch {
      // stats failures never affect the stop decision
    }
  });

  // ─── Compaction preservation ──────────────────────────────────────────────
  pi.on('session.compacting', async () => {
    const mode = getActiveMode();
    if (mode && mode !== 'off' && !INDEPENDENT_MODES.has(mode)) {
      return {
        context: [
          `Caveman mode active (${mode}). The compressed context MUST retain: ` +
          `respond tersely, drop articles/filler/pleasantries/hedging, use fragments. ` +
          `Technical terms, code, commands, error strings must remain exact. ` +
          `Code/commits/PRs should be written normally. ` +
          `This behavior is non-negotiable and must survive compression.`,
        ],
      };
    }
  });

  // ─── Tool result (token counting) ─────────────────────────────────────────
  // Accumulates token counts from model responses for stats. Actual computation
  // happens in stats.ts by reading the session JSONL — this hook is for
  // near-real-time statusline updates.
  pi.on('tool_result', async () => {
    // Token counting is done by reading the session transcript at
    // session_stop time. This hook is a no-op; keeping it for future
    // real-time accumulation if needed.
  });

  // ─── Session shutdown ─────────────────────────────────────────────────────
  pi.on('session_shutdown', async () => {
    // Final stats flush
    try {
      const stats = computeStats({ lifetime: false });
      if (stats.found) {
        writeSessionSnapshot(stats);
        writeLifetimeBadge(stats);
      }
    } catch {
      // best-effort
    }
  });

  // ─── Register slash commands ──────────────────────────────────────────────
  pi.registerCommand('caveman', {
    description: 'Toggle caveman compression mode',
    argumentHint: '[lite|full|ultra|wenyan|wenyan-lite|wenyan-ultra|off]',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const mode = parseCavemanModeArg(args) || 'full';
      setActiveMode(mode);
      const instruction = getCavemanInstruction(mode);
      if (instruction) {
        updateStatusLine(ctx);
        pi.sendMessage(
          `[System: Caveman mode set to "${mode}". ${instruction}]`,
          { deliverAs: 'steer' },
        );
      }
    },
  });

  pi.registerCommand('caveman-stats', {
    description: 'Show token savings statistics',
    argumentHint: '[--lifetime]',
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const lifetime = /\b--lifetime\b/i.test(args) || /\b-l\b/i.test(args);
      const stats = computeStats({ lifetime });
      pi.sendMessage(formatStats(stats), { deliverAs: 'steer' });
    },
  });

  pi.registerCommand('caveman-commit', {
    description: 'Generate conventional commit message',
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      setActiveMode('commit');
      pi.sendMessage(
        'Caveman commit mode active. Generate conventional commit message (≤50 char subject, body only for non-obvious why).',
        { deliverAs: 'steer' },
      );
    },
  });

  pi.registerCommand('caveman-review', {
    description: 'One-line code review comments',
    argumentHint: '<file-or-range>',
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      setActiveMode('review');
      pi.sendMessage(
        'Caveman review mode active. One-line review comments: L<line>: <emoji> <severity>: <problem>. <fix>.',
        { deliverAs: 'steer' },
      );
    },
  });

  pi.registerCommand('caveman-compress', {
    description: 'Compress memory file to caveman format',
    argumentHint: '<filepath>',
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      setActiveMode('compress');
      pi.sendMessage(
        'Caveman compress mode active. Compress the specified file to caveman format. Preserve all code blocks, URLs, paths verbatim. Backup original as <file>.original.md.',
        { deliverAs: 'steer' },
      );
    },
  });

  pi.registerCommand('caveman-help', {
    description: 'Show caveman quick reference card',
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      pi.sendMessage(formatHelpCard(getActiveMode()), {
        deliverAs: 'steer',
      });
    },
  });

  pi.registerCommand('caveman-statusline', {
    description: 'Show/configure caveman status line',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      updateStatusLine(ctx);
      const mode = getActiveMode() || 'off';
      const lifetime = readLifetimeBadge();
      ctx.ui.notify(`Caveman status: ${mode} | lifetime: ${fmtShort(lifetime)} tokens`, 'info');
    },
  });
}

// ── Help card ────────────────────────────────────────────────────────────────

function formatHelpCard(currentMode: string | null): string {
  const mode = currentMode || 'off';
  return [
    '## Caveman Help',
    '',
    `**Current mode:** ${mode}`,
    '',
    '### Mode switching',
    '`/caveman`          — full (default)',
    '`/caveman lite`     — light compression, full sentences',
    '`/caveman full`     — drop articles, fragments OK',
    '`/caveman ultra`    — maximum compression',
    '`/caveman wenyan`   — classical Chinese',
    '`/caveman off`      — disable',
    '',
    '### Commands',
    '`/caveman-stats`    — token savings statistics',
    '`/caveman-commit`   — conventional commit message',
    '`/caveman-review`   — one-line review comments',
    '`/caveman-compress` — compress a file',
    '`/caveman-help`     — this card',
    '`/caveman-statusline` — status line config',
    '',
    '### NL triggers',
    '"talk like caveman" — activate',
    '"stop caveman"      — deactivate',
    '"be brief"          — auto-activate',
  ].join('\n');
}