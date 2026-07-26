#!/usr/bin/env node
// caveman — ZCode SessionStart hook
// Reads stdin JSON, activates caveman mode, injects rules context.
//
// ZCode hook stdout contract (diagnosing-hooks §2): output is a strict JSON
// schema. The only recognized key here is `additionalContext`, injected into
// the conversation. Emit `{}` (or nothing) to pass through silently.

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

  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Malformed stdin: emit nothing, don't crash the session.
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const mode = getDefaultMode();
  const skillContent = resolveSkillContent();

  // Build context injection based on source
  let additionalContext = '';
  const source = input.source || '';
  if (source === 'startup' || source === 'clear' || source === '') {
    // Empty/absent source also activates: ZCode may not always send source.
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

  process.stderr.write(`[caveman] SessionStart: ${mode} mode\n`);
  // Flat schema: only `additionalContext` is recognized. Empty string would
  // inject nothing useful, so emit `{}` when there's no context.
  process.stdout.write(
    JSON.stringify(additionalContext ? { additionalContext } : {})
  );
}

main().catch((err) => {
  process.stderr.write(`[caveman] SessionStart error: ${err.message}\n`);
  // Never block session start on a hook error.
  process.stdout.write(JSON.stringify({}));
});
