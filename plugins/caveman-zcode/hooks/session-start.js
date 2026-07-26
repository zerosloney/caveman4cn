#!/usr/bin/env node
// caveman — ZCode SessionStart hook
// Activates caveman mode and injects the compressed-communication ruleset.
//
// ZCode stdout contract: strict JSON schema.
//   - Inject context: exit 0 + stdout { additionalContext: "..." }
//   - Pass through: exit 0 + stdout {}

const path = require('path');
const fs = require('fs');
const {
  getDefaultMode, safeWriteFlag, recordModeChange
} = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const flagPath = path.join(homeDir, '.caveman-active');

// Resolve plugin root from injected env or from script location
const pluginRoot = process.env.ZCODE_PLUGIN_ROOT || path.resolve(__dirname, '..');

// Locate the canonical caveman SKILL.md to inject as the ruleset.
// Candidate locations, tried in order:
//   1. <plugin_root>/skills/caveman/SKILL.md — plugin install, authoritative
//   2. Adjacent to plugin root (dev checkout)
//   3. Hardcoded fallback if neither found
function resolveSkillContent() {
  const candidates = [
    path.join(pluginRoot, 'skills', 'caveman', 'SKILL.md'),
    path.join(pluginRoot, '..', '..', '..', 'skills', 'caveman', 'SKILL.md'),
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
    // Malformed stdin: emit nothing, don't crash the session.
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const mode = getDefaultMode();
  const skillContent = resolveSkillContent();

  let additionalContext = '';
  const source = input.source || '';
  if (source === 'startup' || source === 'clear' || source === '') {
    // Empty/absent source also activates: ZCode may not always send source.
    additionalContext = skillContent
      ? `Caveman mode active (${mode}). Rules:\n${skillContent}`
      : `Caveman mode active (${mode}). ${FALLBACK_RULES}`;

    // Persist active-mode flag with symlink-safe write.
    recordModeChange(homeDir, mode);
    safeWriteFlag(flagPath, mode);
  }

  process.stderr.write(`[caveman] SessionStart: ${mode} mode\n`);
  process.stdout.write(
    JSON.stringify(additionalContext ? { additionalContext } : {})
  );
}

main().catch((err) => {
  process.stderr.write(`[caveman] SessionStart error: ${err.message}\n`);
  // Never block session start on a hook error.
  process.stdout.write(JSON.stringify({}));
});
