#!/usr/bin/env node
// caveman — ZCode UserPromptSubmit hook (merged)
//
// Merges caveman-mode-tracker.js + user-prompt.js into one hook.
//
// ZCode stdout contract: strict JSON schema.
//   - Block: exit 2 + stderr (reason), stdout {}
//   - Inject context: exit 0 + stdout { additionalContext: "..." }
//   - Pass through: exit 0 + stdout {}
//
// Responsibilities:
//   - /caveman-stats [--share|--lifetime|--all|--since]  -> block (exit 2), return stats
//   - /caveman [lite|full|ultra|wenyan|wenyan-lite|wenyan-ultra|off]  -> switch mode
//   - /caveman-commit / /caveman-review / /caveman-compress  -> one-shot independent mode
//   - NL activation: "talk like caveman", "less tokens", "be brief", "activate caveman"
//   - NL deactivation: "stop caveman", "normal mode", "disable caveman"
//   - Per-turn reinforcement: always emit additionalContext when caveman active
//   - One-shot independent mode restore (#599)
//   - Mode transition log (#601)
//   - Empty prompt blocking

const path = require('path');
const fs = require('fs');
const {
  getDefaultMode, safeWriteFlag, readFlag, recordModeChange, VALID_MODES,
  getAgentFlagPath, getAgentPrevFlagPath
} = require('./caveman-config');
const {
  computeStats, formatStats, writeLifetimeBadge
} = require('./caveman-stats.js');

// Modes handled by their own slash commands — not selectable via /caveman <arg>.
const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);

const flagPath = getAgentFlagPath();
const prevPath = getAgentPrevFlagPath();

// ── Stats handling ──────────────────────────────────────────────────────────

function isStatsPrompt(prompt) {
  return /^\/caveman-stats(\s|$)/i.test((prompt || '').trim());
}

function handleStatsPrompt(prompt) {
  const lifetime = /\s--(lifetime|all|since)\b/i.test(prompt) || /\s--all\b/.test(prompt);
  const share = /\s--share\b/.test(prompt);

  const stats = computeStats({ lifetime });
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

  // ZCode: block via exit 2 + stderr
  process.stderr.write(`[caveman] /caveman-stats (${lifetime ? 'lifetime' : 'session'}):\n${body}\n`);
  process.stdout.write(JSON.stringify({}));
  process.exit(2);
}

// ── Mode parsing ────────────────────────────────────────────────────────────

// NL activation patterns — ported from upstream caveman-mode-tracker.js
function parseNlActivation(prompt) {
  const wantsOff =
    /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/.test(prompt) ||
    /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/.test(prompt) ||
    /\bturn\s+off\s+(the\s+)?caveman\b/.test(prompt) ||
    /^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/.test(prompt) ||
    (/\bnormal\s+mode\b/.test(prompt) && /\bcaveman\b/.test(prompt));

  // Questions about caveman are not activation commands
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

// Parse /caveman <arg> slash commands. Returns the mode string or null.
function parseSlashCommand(prompt) {
  const lower = prompt.toLowerCase().trim();
  if (!lower.startsWith('/caveman')) return null;

  const parts = lower.split(/\s+/);
  const cmd = parts[0];
  const arg = parts[1] || '';

  // /caveman-commit, /caveman-review, /caveman-compress
  for (const m of INDEPENDENT_MODES) {
    if (cmd === `/caveman-${m}` || cmd === `/caveman:caveman-${m}`) {
      return m;
    }
  }

  // /caveman [lite|full|ultra|wenyan|...]
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
    // Bad stdin — pass through, never trap the user.
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const prompt = (input.prompt || '').trim();

  // ── Empty prompt block ──────────────────────────────────────────────────
  if (!prompt || prompt.length < 3) {
    process.stderr.write('[caveman] Empty prompt blocked. Provide a specific question.\n');
    process.stdout.write(JSON.stringify({}));
    process.exit(2);
  }

  // ── /caveman-stats intercept ────────────────────────────────────────────
  if (isStatsPrompt(prompt)) {
    handleStatsPrompt(prompt);
    return; // unreachable (handleStatsPrompt exits)
  }

  // ── Mode tracking ───────────────────────────────────────────────────────
  const lowerPrompt = prompt.toLowerCase().replace(/\s+/g, ' ');
  let changedMode = false;
  let currentMode = readFlag(flagPath) || getDefaultMode();

  // 1. Try slash command (/caveman, /caveman-commit, etc.)
  const slashMode = parseSlashCommand(lowerPrompt);
  if (slashMode) {
    if (slashMode === 'off') {
      recordModeChange(null);
      try { fs.unlinkSync(flagPath); } catch (e) {}
      try { fs.unlinkSync(prevPath); } catch (e) {}
      currentMode = null;
      changedMode = true;
    } else if (INDEPENDENT_MODES.has(slashMode)) {
      // Save the prose mode being displaced (#599)
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

  // 2. Try NL activation (only if slash command didn't fire)
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

  // 3. One-shot independent mode restore (#599): if the flag still holds an
  // independent mode from a PREVIOUS prompt, restore the saved prose mode.
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
  // Always emit when caveman is active, never just when keywords are detected.
  // This keeps caveman visible in the model's attention on every user message.
  let additionalContext = '';
  if (currentMode && !INDEPENDENT_MODES.has(currentMode)) {
    additionalContext =
      `CAVEMAN MODE ACTIVE (${currentMode}). ` +
      `Drop articles/filler/pleasantries/hedging. Fragments OK. ` +
      `Code/commits/security: write normal.`;
  }

  process.stdout.write(
    JSON.stringify(additionalContext ? { additionalContext } : {})
  );
}

main().catch((err) => {
  process.stderr.write(`[caveman] UserPromptSubmit error: ${err.message}\n`);
  // Pass through on any error — never trap the user.
  process.stdout.write(JSON.stringify({}));
});
