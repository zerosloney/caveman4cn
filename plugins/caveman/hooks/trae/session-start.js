#!/usr/bin/env node
// caveman — Trae SessionStart hook
// Activates caveman mode and injects the compressed-communication ruleset.
//
// Trae contract (https://docs.trae.cn/ide_hook-configuration-reference):
//   - stdin:  JSON { session_id, cwd, hook_event_name, workspace_roots, source }
//   - stdout: JSON { hookSpecificOutput: { additionalContext } } OR plain text.
//             Plain text / additionalContext is appended to the model context.
//   - exit 0: normal. exit 2: stderr fed to model as error. other: ignored.
//   - env:   TRAE_PROJECT_DIR / CLAUDE_PROJECT_DIR set; TRAE_ENV_FILE set at SessionStart.
//
// Trae does NOT inject a plugin-root env var, so resolve from this script's
// location (the installer places hooks under ~/.trae-cn/caveman/hooks/trae/).
// Also honour TRAE_PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT if a user sets them.

const path = require('path');
const fs = require('fs');
const {
  getDefaultMode, safeWriteFlag, recordModeChange, getAgentFlagPath, migrateLegacyFiles
} = require('./caveman-config');

const flagPath = getAgentFlagPath();

// Resolve plugin root. Trae sets no plugin-root var; CLAUDE_PLUGIN_ROOT is a
// legacy alias; final fallback resolves from this script's location.
function pluginRoot() {
  return (
    process.env.TRAE_PLUGIN_ROOT ||
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

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const mode = getDefaultMode();
  const skillContent = resolveSkillContent();

  // One-time migration of legacy flat-layout state into this agent's subdir.
  migrateLegacyFiles();

  let additionalContext = '';
  const source = input.source || '';
  // Trae sends source on SessionStart; treat empty/unknown the same as startup
  // so caveman activates on the first message (mirrors CodeBuddy behaviour).
  if (source === 'startup' || source === 'clear' || source === 'compact' || source === '') {
    additionalContext = skillContent
      ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
      : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;

    recordModeChange(mode);
    safeWriteFlag(flagPath, mode);
  }

  // Trae accepts either plain text or { hookSpecificOutput: { additionalContext } }.
  // Emit the structured form for forward-compatibility.
  const output = { hookSpecificOutput: { additionalContext } };
  process.stderr.write(`[caveman] SessionStart: ${mode} mode\n`);
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] SessionStart error: ${err.message}\n`);
  // Never block session start on a hook error — emit empty context and exit 0.
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: '' } }));
});
