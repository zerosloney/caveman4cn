#!/usr/bin/env node
// caveman — Reasonix UserPromptSubmit hook
//
// Reasonix supports a real SessionStart event, so this hook does NOT carry the
// first-prompt activation fallback that Qoder's does — session-start.js handles
// activation. This hook is responsible for:
//   - /caveman-stats intercept
//   - /caveman mode switching + one-shot independent modes
//   - NL activation/deactivation
//   - Per-turn reinforcement when caveman active
//   - One-shot independent mode restore (#599)
//   - Mode transition log (#601)
//   - Empty prompt blocking
//
// Reasonix contract:
//   - stdin: JSON { event, cwd, prompt, turn }
//   - stdout: JSON envelope. To pass through with context:
//             { hookSpecificOutput: { hookEventName, additionalContext } }.
//   - UserPromptSubmit is BLOCKING: exit 2 + stderr blocks the turn and feeds
//     stderr to the model. exit 0 + JSON continues.
//
// Reference: Reasonix DESKTOP_HOOKS.zh-CN.md.

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

function pluginRoot() {
  return (
    process.env.REASONIX_PLUGIN_ROOT ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    path.resolve(__dirname, '..', '..')
  );
}

function resolveSkillContent() {
  const root = pluginRoot();
  const candidates = [
    path.join(root, 'skills', 'caveman', 'SKILL.md'),
    path.join(__dirname, '..', '..', '..', 'skills', 'caveman', 'SKILL.md'),
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

// ── Stats handling ──────────────────────────────────────────────────────────

function isStatsPrompt(prompt) {
  return /^\/caveman-stats(\s|$)/i.test((prompt || '').trim());
}

// Reasonix stdin does not carry a transcript_path. We pass the cwd so
// caveman-stats can (if needed) scope its probe, but the primary strategy is
// probing ~/.reasonix/ candidate roots (see caveman-stats.js).
function handleStatsPrompt(input, prompt) {
  const lifetime = /\s--(lifetime|all|since)\b/i.test(prompt) || /\s--all\b/.test(prompt);
  const share = /\s--share\b/.test(prompt);

  const cwd = (!lifetime && input && input.cwd) ? input.cwd : null;

  const stats = computeStats({ lifetime, cwd });
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

  // Block the turn — Reasonix surfaces stderr as the reason for the block.
  process.stderr.write(body + '\n');
  process.exit(2);
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
    process.stderr.write('[caveman] Empty prompt blocked. Provide a specific question.\n');
    process.exit(2);
  }

  // ── /caveman-stats intercept (blocks via exit 2) ────────────────────────
  if (isStatsPrompt(prompt)) {
    handleStatsPrompt(input, prompt);
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
  let additionalContext = '';
  if (currentMode && !INDEPENDENT_MODES.has(currentMode)) {
    // On the first turn after activation (no flag existed when session-start
    // ran, or mode just switched), inject the full ruleset. After that, a
    // short reinforcement is enough.
    const skill = changedMode ? resolveSkillContent() : '';
    if (skill) {
      additionalContext = `Caveman mode active (${currentMode}). Rules:\n${skill}`;
    } else {
      additionalContext =
        `CAVEMAN MODE ACTIVE (${currentMode}). ` +
        `Drop articles/filler/pleasantries/hedging. Fragments OK. ` +
        `Code/commits/security: write normal.`;
    }
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] UserPromptSubmit error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
