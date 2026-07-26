#!/usr/bin/env node
// caveman — CodeBuddy SessionStart hook
// Activates caveman mode and injects the compressed-communication ruleset.
//
// CodeBuddy contract (verified against official plugins):
//   - stdin: JSON with { hook_event_name, source, ... }
//   - stdout: JSON envelope. For context injection emit { additionalContext: "..." }
//   - plugin root: process.env.CODEBUDDY_PLUGIN_ROOT (fallback CLAUDE_PLUGIN_ROOT, then __dirname/..)

const path = require('path');
const fs = require('fs');

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
function resolveSkillContent() {
  const root = pluginRoot();
  const candidates = [
    path.join(root, 'skills', 'caveman', 'SKILL.md'),
    path.join(root, '..', '..', 'skills', 'caveman', 'SKILL.md'),
  ];
  for (const c of candidates) {
    try {
      return fs.readFileSync(c, 'utf-8');
    } catch {}
  }
  return '';
}

function getDefaultMode() {
  return process.env.CAVEMAN_DEFAULT_MODE || 'full';
}

async function main() {
  // Read stdin JSON. SessionStart may send { source: 'startup'|'clear'|'compact' }.
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

  const FALLBACK_RULES =
    'Caveman mode active. Respond terse like smart caveman — drop articles, ' +
    'filler, pleasantries. Fragments OK. Technical terms exact. Code unchanged.';

  let additionalContext = '';
  const source = input.source || '';
  if (source === 'startup' || source === 'clear' || source === '') {
    // Empty/absent source also activates: CodeBuddy may not always send source.
    additionalContext = skillContent
      ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
      : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;

    // Persist active-mode flag so pre-tool-use.js can read it via isCavemanActive().
    try {
      const flagPath = path.join(
        process.env.USERPROFILE || process.env.HOME || '.',
        '.caveman-active'
      );
      fs.writeFileSync(flagPath, mode);
    } catch {}
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
