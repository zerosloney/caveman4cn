#!/usr/bin/env node
// caveman init (Qoder build) — drop the always-on caveman activation rule
// into a target repo's AGENTS.md. Qoder reads AGENTS.md on every session,
// so this makes caveman mode auto-activate with no per-session prompt.
// Idempotent. Safe to re-run.
//
// Usage:
//   node tools/caveman-init.js [target-dir] [--dry-run] [--force]
//
// Without args, runs in cwd. Appends the rule block to AGENTS.md (creating it
// if absent). Does NOT modify CLAUDE.md or compress existing memory files —
// that's the job of `/caveman-compress`.
//
// Ported from upstream src/tools/caveman-init.js, scoped to AGENTS.md only
// (Qoder's discovery convention). Cursor/Windsurf/Cline/Copilot/OpenClaw
// targets dropped — they belong to other host ecosystems.

const fs = require('fs');
const path = require('path');

// Embedded so the tool works standalone. Mirrors the activation rule shipped
// in skills/caveman/SKILL.md — keep these in sync.
const RULE_BODY = `Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
`;

const SENTINEL = 'Respond terse like smart caveman';

const TARGET = {
  id: 'agents',
  file: 'AGENTS.md',
  mode: 'append', // append to existing AGENTS.md, or create if absent
};

function loadRuleBody() {
  // The full skills/caveman/SKILL.md is too large for an AGENTS.md injection
  // (it ships the intensity table, persistence rules, etc.). The activation
  // snippet below is the terse always-on rule — same one upstream embeds in
  // src/tools/caveman-init.js as RULE_BODY. Keep these in sync.
  return RULE_BODY;
}

function processTarget(target, targetDir, ruleBody, opts) {
  const fullPath = path.join(targetDir, target.file);
  const exists = fs.existsSync(fullPath);

  if (!exists) {
    if (!opts.dryRun) {
      fs.writeFileSync(fullPath, ruleBody, { mode: 0o644 });
    }
    return { status: 'added', label: '+' };
  }

  const existing = fs.readFileSync(fullPath, 'utf8');
  if (existing.includes(SENTINEL)) {
    return { status: 'skipped-already-installed', label: '=' };
  }

  if (!opts.dryRun) {
    const sep = existing.endsWith('\n\n') ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
    fs.writeFileSync(fullPath, existing + sep + ruleBody, { mode: 0o644 });
  }
  return { status: 'appended', label: '~' };
}

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, target: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force' || a === '-f') opts.force = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('-')) opts.target = path.resolve(a);
  }
  return opts;
}

function help() {
  console.log(`caveman init (Qoder) — drop always-on caveman rule into AGENTS.md

Usage: caveman-init.js [target-dir] [--dry-run] [--force]

Defaults to current working directory. Idempotent — safe to re-run.

Target:
  AGENTS.md   appended (created if absent). Qoder reads this every session.

Flags:
  --dry-run   show what would change, do not write
  --force     overwrite an existing rule block (default: skip if sentinel present)
`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { help(); return; }

  console.log(`🪨 caveman init (Qoder) — ${opts.target}${opts.dryRun ? ' (dry run)' : ''}\n`);

  const ruleBody = loadRuleBody();
  const result = processTarget(TARGET, opts.target, ruleBody, opts);
  console.log(`  ${result.label} ${TARGET.file} (${result.status})`);

  const label = result.status === 'added' ? 'added'
    : result.status === 'appended' ? 'appended'
    : result.status === 'overwritten' ? 'overwritten'
    : 'skipped';
  console.log(`\n1 ${label}`);
  if (opts.dryRun) console.log('(dry run — no files were written)');
}

// Run when executed directly AND when piped via `curl … | node -`.
if (require.main === module || (!require.main && module.id === '[stdin]')) main();

module.exports = { processTarget, loadRuleBody, TARGET, SENTINEL, RULE_BODY };
