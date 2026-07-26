#!/usr/bin/env node
// caveman — ZCode SessionStart hook
// Reads stdin JSON, activates caveman mode, injects rules context.

const path = require('path');
const fs = require('fs');

// Resolve plugin root from injected env or from script location
const pluginRoot = process.env.ZCODE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginRoot, '..', '..');

// Resolve the canonical SKILL.md for full ruleset injection
function resolveSkillContent() {
  const candidates = [
    path.join(pluginRoot, 'skills', 'caveman', 'SKILL.md'),
    path.join(repoRoot, 'skills', 'caveman', 'SKILL.md'),
    path.join(pluginRoot, '..', '..', '..', 'skills', 'caveman', 'SKILL.md'),
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
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  const input = JSON.parse(raw);
  const mode = getDefaultMode();
  const skillContent = resolveSkillContent();

  // Build context injection based on source
  let additionalContext = '';
  if (input.source === 'startup' || input.source === 'clear') {
    additionalContext = skillContent
      ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
      : `Caveman mode active (${mode}). Respond terse like smart caveman — drop articles, filler, pleasantries. Fragments OK. Technical terms exact. Code unchanged.`;

    // Persist active-mode flag so other hooks (stop/pre-tool-use/user-prompt)
    // see caveman as active via isCavemanActive(). Without this write, those
    // read-only checks always return false and their caveman branches stay dead.
    try {
      const flagPath = path.join(
        process.env.HOME || process.env.USERPROFILE || '.',
        '.caveman-active'
      );
      fs.writeFileSync(flagPath, mode);
    } catch {}
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'SessionStart',
      additionalContext,
    },
  };

  process.stderr.write(`[caveman] SessionStart: ${mode} mode\n`);
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] SessionStart error: ${err.message}\n`);
  process.exit(1);
});