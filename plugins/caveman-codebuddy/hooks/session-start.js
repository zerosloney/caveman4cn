#!/usr/bin/env node
// caveman — CodeBuddy SessionStart hook
// Activates caveman mode and injects the compressed-communication ruleset.
//
// CodeBuddy contract:
//   - stdin: JSON with { hook_event_name, source, ... }
//   - stdout: JSON envelope. For context injection emit { additionalContext: "..." }
//   - plugin root: process.env.CODEBUDDY_PLUGIN_ROOT (fallback CLAUDE_PLUGIN_ROOT, then __dirname/..)

const os = require('os');
const path = require('path');
const fs = require('fs');
const {
  getDefaultMode, safeWriteFlag, recordModeChange,
  getAgentFlagPath, migrateLegacyFiles
} = require('./caveman-config');

const flagPath = getAgentFlagPath();

// Resolve plugin root. CodeBuddy sets CODEBUDDY_PLUGIN_ROOT; CLAUDE_PLUGIN_ROOT is
// a legacy alias; final fallback resolves from this script's location.
function pluginRoot() {
  return (
    process.env.CODEBUDDY_PLUGIN_ROOT ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    path.resolve(__dirname, '..')
  );
}

// Locate the canonical caveman SKILL.md to inject as the ruleset.
// Candidate locations, tried in order:
//   1. <plugin_root>/skills/caveman/SKILL.md — plugin install, authoritative
//   2. <plugin_root>/../skills/caveman/SKILL.md — adjacent checkout
//   3. Hardcoded fallback if neither found
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

// ── Windows statusline auto-config ───────────────────────────────────────────
// On Windows, CodeBuddy's ~ expansion in statusLine.command is unreliable.
// Fix the path to use an absolute resolved path pointing to the caveman
// plugin's statusline.js script.

function ensureStatuslineConfig() {
  if (process.platform !== 'win32') return;

  const settingsPath = path.join(os.homedir(), '.codebuddy', 'settings.json');
  if (!fs.existsSync(settingsPath)) return;

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return;
  }

  const statuslineScript = path.join(pluginRoot(), 'scripts', 'statusline.js');
  const absPath = path.resolve(statuslineScript);
  const normalized = 'node ' + absPath.replace(/\\/g, '/');

  const sl = settings.statusLine;

  // Case A: Not configured → add it with absolute path
  if (!sl) {
    settings.statusLine = {
      type: 'command',
      command: normalized,
      padding: 0,
    };
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      process.stderr.write(`[caveman] Added statusline config for Windows: ${normalized}\n`);
    } catch (e) {
      process.stderr.write(`[caveman] Failed to add statusline: ${e.message}\n`);
    }
    return;
  }

  // Case B: Configured with ~ and points to caveman plugin → replace with absolute
  if (sl.type === 'command' && sl.command && sl.command.includes('~') && sl.command.includes('caveman-codebuddy')) {
    if (sl.command === normalized) return;
    const prev = sl.command;
    sl.command = normalized;
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      process.stderr.write(`[caveman] Fixed statusline command for Windows: ${prev} -> ${normalized}\n`);
    } catch (e) {
      process.stderr.write(`[caveman] Failed to fix statusline command: ${e.message}\n`);
    }
  }
}

async function main() {
  // Read stdin JSON. SessionStart may send { source: 'startup' }.
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Malformed stdin: emit minimal context, don't crash the session.
    input = {};
  }

  const mode = getDefaultMode();
  const skillContent = resolveSkillContent();

  // One-time migration of legacy flat-layout state into this agent's subdir.
  migrateLegacyFiles();

  let additionalContext = '';
  const source = input.source || '';
  if (source === 'startup' || source === 'clear' || source === 'compact' || source === '') {
    // Empty/absent source also activates: CodeBuddy may not always send source.
    additionalContext = skillContent
      ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
      : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;

    // Persist active-mode flag with symlink-safe write.
    recordModeChange(mode);
    safeWriteFlag(flagPath, mode);

    // Auto-fix statusline path on Windows (where ~ expansion is unreliable)
    ensureStatuslineConfig();
  }

  const output = { additionalContext };
  process.stderr.write(`[caveman] SessionStart: ${mode} mode\n`);
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] SessionStart error: ${err.message}\n`);
  // Never block session start on a hook error — emit empty context and exit 0.
  process.stdout.write(JSON.stringify({ additionalContext: '' }));
});
