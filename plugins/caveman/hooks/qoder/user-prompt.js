#!/usr/bin/env node
// caveman — Qoder UserPromptSubmit hook (merged, with SessionStart fallback)
//
// Qoder does NOT support a SessionStart event (only UserPromptSubmit /
// PreToolUse / PostToolUse / PostToolUseFailure / Stop). The caveman
// activation that other hosts do in SessionStart is folded into this hook:
// on every UserPromptSubmit, if no mode flag exists yet, we write the default
// mode and inject the SKILL.md ruleset — so the first user message of a
// session auto-activates caveman, equivalent to SessionStart.
//
// Qoder contract:
//   - stdin: JSON { hook_event_name, prompt, transcript_path, ... }
//   - stdout: JSON. To block: { continue:false, reason, hookSpecificOutput:{additionalContext} }
//             or exit 2 with reason on stderr. To pass through with context:
//             { hookSpecificOutput:{ additionalContext } }.
//
// Responsibilities:
//   - SessionStart fallback: activate default mode + inject SKILL.md on first prompt
//   - /caveman-stats [--share|--lifetime|--all|--since]  -> block, return stats
//   - /caveman [lite|full|ultra|wenyan|wenyan-lite|wenyan-ultra|off]  -> switch mode
//   - /caveman-commit / /caveman-review / /caveman-compress  -> one-shot independent mode
//   - NL activation/deactivation
//   - Per-turn reinforcement when caveman active
//   - One-shot independent mode restore (#599)
//   - Mode transition log (#601)
//   - Empty prompt blocking

const path = require('path');
const fs = require('fs');
const {
  getDefaultMode, safeWriteFlag, readFlag, recordModeChange, VALID_MODES, getAgentFlagPath, getAgentPrevFlagPath
} = require('./caveman-config');
const {
  computeStats, formatStats, writeLifetimeBadge
} = require('./caveman-stats.js');

const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);

const flagPath = getAgentFlagPath();
const prevPath = getAgentPrevFlagPath();

// Resolve plugin root. Qoder injects QODER_PLUGIN_ROOT for registered plugins;
// CLAUDE_PLUGIN_ROOT is a legacy alias; final fallback resolves from this
// script's location (works when installed via filesystem without qodercli).
function pluginRoot() {
  return (
    process.env.QODER_PLUGIN_ROOT ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    path.resolve(__dirname, '..')
  );
}

// Locate the canonical caveman SKILL.md to inject as the ruleset.
function resolveSkillContent() {
  const root = pluginRoot();
  const candidates = [
    path.join(root, 'skills', 'caveman', 'SKILL.md'),
    path.join(root, '..', 'skills', 'caveman', 'SKILL.md'),
  ];
  for (const c of candidates) {
    try {
      return fs.readFileSync(c, 'utf-8');
    } catch {}
  }
  return '';
}

const FALLBACK_RULES =
  'Caveman mode active. Respond terse like smart caveman — drop articles, ' +
  'filler, pleasantries. Fragments OK. Technical terms exact. Code unchanged.';

// ── SessionStart fallback ────────────────────────────────────────────────────
// Qoder has no SessionStart event. On the first UserPromptSubmit of a session,
// if no mode flag exists, activate the default mode and return the ruleset as
// additionalContext so the model loads caveman behavior immediately.
// Returns the activation context string, or '' if already active / off.
function maybeActivateOnFirstPrompt() {
  if (readFlag(flagPath) !== null) return ''; // already activated this session
  const mode = getDefaultMode();
  if (mode === 'off') return '';
  recordModeChange(mode);
  safeWriteFlag(flagPath, mode);
  const skill = resolveSkillContent();
  const ctx = skill
    ? `Caveman mode active (${mode}). Rules:\n${skill}`
    : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;
  process.stderr.write(`[caveman] UserPromptSubmit: first-prompt activation (${mode})\n`);
  return ctx;
}

// ── Stats handling ──────────────────────────────────────────────────────────

function isStatsPrompt(prompt) {
  return /^\/caveman-stats(\s|$)/i.test((prompt || '').trim());
}

function handleStatsPrompt(input, prompt) {
  const lifetime = /\s--(lifetime|all|since)\b/i.test(prompt) || /\s--all\b/.test(prompt);
  const share = /\s--share\b/.test(prompt);

  // Qoder's hook stdin carries transcript_path (universal field) — prefer it.
  const transcript = (!lifetime && input && input.transcript_path) ? input.transcript_path : null;

  const stats = computeStats({ lifetime, transcript });
  writeLifetimeBadge(stats);

  let body;
  if (share) {
    if (!stats.found) {
      body = 'No session log found yet.';
    } else {
      const scope = stats.lifetime ? 'Lifetime' : 'Session';
      body = `⛏ ${scope}: ~${stats.saved.toLocaleString('en-US')} tokens saved via caveman mode (rough estimate)`;
    }
  } else {
    body = formatStats(stats);
  }

  process.stderr.write(`[caveman] /caveman-stats (${lifetime ? 'lifetime' : 'session'})\n`);

  return {
    continue: false,
    reason: body,
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'UserPromptSubmit',
      additionalContext: body,
    },
  };
}

// ── Mode parsing ────────────────────────────────────────────────────────────

function parseNlActivation(prompt) {
  const wantsOff =
    /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/.test(prompt) ||
    /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/.test(prompt) ||
    /\bturn\s+off\s+(the\s+)?caveman\b/.test(prompt) ||
    /^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/.test(prompt) ||
    (/\bnormal\s+mode\b/.test(prompt) && /\bcaveman\b/.test(prompt));

  const isQuestion =
    /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/.test(prompt);

  if (wantsOff) return 'off';

  if (!isQuestion) {
    if (/\b(activate|enable|start|turn on|use|switch to|want|give me)\b[^.]{0,40}\bcaveman\b/.test(prompt) ||
        /\btalk like\b[^.]{0,40}\bcaveman\b/.test(prompt) ||
        /\bcaveman\s+mode\s+(on|please|now)\b/.test(prompt) ||
        /^caveman(\s+mode)?\s*[.!]*$/.test(prompt) ||
        /\b(less tokens|fewer tokens|be brief|be terse|shorter answers)\b(?!\s+(in|for|on|about|when|during|with)\b)/.test(prompt)) {
      return getDefaultMode();
    }
  }

  return null;
}

function parseSlashCommand(prompt) {
  const lower = prompt.toLowerCase().trim();
  if (!lower.startsWith('/caveman')) return null;

  const parts = lower.split(/\s+/);
  const cmd = parts[0];
  const arg = parts[1] || '';

  for (const m of INDEPENDENT_MODES) {
    if (cmd === `/caveman-${m}` || cmd === `/caveman:caveman-${m}`) {
      return m;
    }
  }

  if (cmd === '/caveman' || cmd === '/caveman:caveman') {
    if (!arg) return getDefaultMode();
    if (arg === 'off' || arg === 'stop' || arg === 'disable') return 'off';
    if (arg === 'wenyan-full') return 'wenyan';
    if (VALID_MODES.includes(arg) && !INDEPENDENT_MODES.has(arg)) return arg;
  }

  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const prompt = (input.prompt || '').trim();

  // ── Empty prompt block ──────────────────────────────────────────────────
  if (!prompt || prompt.length < 3) {
    const output = {
      continue: false,
      reason: 'Empty prompt blocked. Provide a specific question.',
      hookSpecificOutput: {
        hookEventName: input.hook_event_name || 'UserPromptSubmit',
        additionalContext: 'Empty prompt blocked. Provide a specific question.',
      },
    };
    process.stderr.write('[caveman] empty prompt blocked\n');
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // ── SessionStart fallback: activate on first prompt of session ──────────
  const activationContext = maybeActivateOnFirstPrompt();

  // ── /caveman-stats intercept ────────────────────────────────────────────
  if (isStatsPrompt(prompt)) {
    const output = handleStatsPrompt(input, prompt);
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // ── Mode tracking ───────────────────────────────────────────────────────
  const lowerPrompt = prompt.toLowerCase().replace(/\s+/g, ' ');
  let changedMode = false;
  let currentMode = readFlag(flagPath) || getDefaultMode();

  const slashMode = parseSlashCommand(lowerPrompt);
  if (slashMode) {
    if (slashMode === 'off') {
      recordModeChange(null);
      try { fs.unlinkSync(flagPath); } catch (e) {}
      try { fs.unlinkSync(prevPath); } catch (e) {}
      currentMode = null;
      changedMode = true;
    } else if (INDEPENDENT_MODES.has(slashMode)) {
      const current = readFlag(flagPath);
      if (current && !INDEPENDENT_MODES.has(current)) {
        safeWriteFlag(prevPath, current);
      }
      recordModeChange(slashMode);
      safeWriteFlag(flagPath, slashMode);
      currentMode = slashMode;
      changedMode = true;
    } else {
      recordModeChange(slashMode);
      safeWriteFlag(flagPath, slashMode);
      currentMode = slashMode;
      changedMode = true;
    }
  }

  if (!slashMode) {
    const nlMode = parseNlActivation(lowerPrompt);
    if (nlMode === 'off') {
      recordModeChange(null);
      try { fs.unlinkSync(flagPath); } catch (e) {}
      try { fs.unlinkSync(prevPath); } catch (e) {}
      currentMode = null;
      changedMode = true;
    } else if (nlMode && nlMode !== 'off') {
      const mode = getDefaultMode();
      if (mode !== 'off') {
        recordModeChange(mode);
        safeWriteFlag(flagPath, mode);
        currentMode = mode;
        changedMode = true;
      }
    }
  }

  // ── One-shot independent mode restore (#599) ────────────────────────────
  if (currentMode && INDEPENDENT_MODES.has(currentMode) && !changedMode) {
    const prev = readFlag(prevPath);
    try { fs.unlinkSync(prevPath); } catch (e) {}
    if (prev && !INDEPENDENT_MODES.has(prev)) {
      recordModeChange(prev);
      safeWriteFlag(flagPath, prev);
      currentMode = prev;
    } else {
      recordModeChange(null);
      try { fs.unlinkSync(flagPath); } catch (e) {}
      currentMode = null;
    }
  }

  // ── Per-turn reinforcement ──────────────────────────────────────────────
  let additionalContext = activationContext;
  if (currentMode && !INDEPENDENT_MODES.has(currentMode)) {
    const reinforcement =
      `CAVEMAN MODE ACTIVE (${currentMode}). ` +
      `Drop articles/filler/pleasantries/hedging. Fragments OK. ` +
      `Code/commits/security: write normal.`;
    additionalContext = additionalContext
      ? additionalContext + '\n\n' + reinforcement
      : reinforcement;
  }

  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'UserPromptSubmit',
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] UserPromptSubmit error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
