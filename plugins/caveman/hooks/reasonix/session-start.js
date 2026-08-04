#!/usr/bin/env node
// caveman — Reasonix SessionStart hook
// Activates caveman mode and injects the compressed-communication ruleset.
//
// Reasonix contract (Claude-style settings.json hooks):
//   - stdin: JSON { event, cwd, ... } (SessionStart carries no extra keys)
//   - stdout: plain text injected as one-time context for the next model turn;
//             OR a JSON envelope { hookSpecificOutput: { hookEventName,
//             additionalContext } }. Both forms inject additionalContext.
//   - exit 0: pass. Non-2 non-zero: warn, non-blocking.
//
// Reference: Reasonix DESKTOP_HOOKS.zh-CN.md.

const path = require('path');
const fs = require('fs');
const {
  getDefaultMode, safeWriteFlag, recordModeChange, getAgentFlagPath, migrateLegacyFiles
} = require('./caveman-config');

const flagPath = getAgentFlagPath();

// Reasonix does not document a plugin-root env var. Resolve from this script's
// location: <plugin_root>/hooks/reasonix/session-start.js → <plugin_root>/skills/...
function pluginRoot() {
  return (
    process.env.REASONIX_PLUGIN_ROOT ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    path.resolve(__dirname, '..', '..')
  );
}

// Locate the canonical caveman SKILL.md to inject as the ruleset.
function resolveSkillContent() {
  const root = pluginRoot();
  const candidates = [
    path.join(root, 'skills', 'caveman', 'SKILL.md'),
    // repo checkout layout: hooks/reasonix/ → ../../../skills/
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

async function main() {
  // Read stdin JSON. Reasonix pipes a single JSON line: {"event":"SessionStart","cwd":"..."}.
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

  migrateLegacyFiles();

  const context = skillContent
    ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
    : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;

  recordModeChange(mode);
  safeWriteFlag(flagPath, mode);

  // Reasonix injects stdout (plain text) OR a JSON envelope. Use the JSON
  // envelope form — matches the documented hookSpecificOutput.additionalContext
  // contract and is symmetric with the other Reasonix hooks below.
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };
  process.stderr.write(`[caveman] SessionStart: ${mode} mode\n`);
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] SessionStart error: ${err.message}\n`);
  // Never block session start on a hook error — emit empty context and exit 0.
  process.stdout.write(JSON.stringify({ additionalContext: '' }));
});
