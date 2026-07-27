#!/usr/bin/env node
// caveman — Qwen Code SessionStart hook
// Activates caveman mode and injects the compressed-communication ruleset.
//
// Qwen Code contract:
//   - stdin: JSON { hook_event_name, source, ... }
//   - stdout: JSON. For context injection emit { additionalContext: "..." }
//   - extension root: ${extensionPath} at install time (installer writes the
//     absolute path into ~/.qwen/settings.json), but the hook process itself
//     receives no env var — resolve from this script's location as fallback.
//     QWEN_EXTENSION_PATH is honored if the user sets it.

const path = require('path');
const fs = require('fs');
const {
  getDefaultMode, safeWriteFlag, recordModeChange, getAgentFlagPath, migrateLegacyFiles
} = require('./caveman-config');

const flagPath = getAgentFlagPath();

// Resolve extension root. Qwen Code does not inject a plugin-root env var into
// hook processes the way ZCode/CodeBuddy do; the installer writes absolute
// POSIX paths into settings.json. We still honor QWEN_EXTENSION_PATH /
// CLAUDE_PLUGIN_ROOT if set, then fall back to this script's location.
function pluginRoot() {
  return (
    process.env.QWEN_EXTENSION_PATH ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    path.resolve(__dirname, '..')
  );
}

// Locate the canonical caveman SKILL.md to inject as the ruleset.
// Candidate locations, tried in order:
//   1. <plugin_root>/skills/caveman/SKILL.md — extension install, authoritative
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
    // Empty/absent source also activates: Qwen may not always send source.
    additionalContext = skillContent
      ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
      : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;

    // Persist active-mode flag with symlink-safe write.
    recordModeChange(mode);
    safeWriteFlag(flagPath, mode);
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
