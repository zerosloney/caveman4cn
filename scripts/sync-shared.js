#!/usr/bin/env node
// sync-shared — regenerate plugin caveman-config.js files from the template.
//
// Single source of truth: shared/caveman-config.template.js
// Targets: plugins/caveman/hooks/<id>/caveman-config.js
//
// Render rules (deliberately tiny — no template engine dependency):
//   {{AGENT_ID}}      → quoted agent id, e.g. 'zcode'
//   {{AGENT_LABEL}}   → human label for the header comment, e.g. ZCode
//   {{#ZCODE_ENV}}...{{/ZCODE_ENV}}  → conditional block kept only for the
//                                       zcode build (its getCavemanRoot reads
//                                       process.env.ZCODE_PLUGIN_DATA); the
//                                       block's inner text replaces the tags
//                                       for zcode and is removed for others.
//
// Exit codes (consumed by the pre-commit hook):
//   0 — every target is already in sync with the template
//   1 — one or more targets were updated (or a check failed); re-stage needed
//   2 — unrecoverable error (template missing, render invariant violated)
//
// Idempotent: running twice produces byte-identical output, so a clean tree
// stays clean.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'shared', 'caveman-config.template.js');

// Agent registry. Add a new IDE plugin here and it joins the sync automatically.
// `zcodeEnv: true` enables the {{#ZCODE_ENV}} conditional (env-overridable data
// root, used only by zcode's host which injects ZCODE_PLUGIN_DATA).
const AGENTS = [
  { id: 'codebuddy', label: 'CodeBuddy', zcodeEnv: false },
  { id: 'qoder',     label: 'Qoder',     zcodeEnv: false },
  { id: 'qwen',      label: 'Qwen Code', zcodeEnv: false },
  { id: 'trae',      label: 'Trae',      zcodeEnv: false },
  { id: 'zcode',     label: 'ZCode',     zcodeEnv: true  },
  { id: 'reasonix',  label: 'Reasonix',  zcodeEnv: false },
];

// Render the template for one agent. Pure function — same input ⇒ same output.
function render(template, agent) {
  let out = template;

  // Conditional block first, before the {{...}} string placeholders could
  // accidentally interact with block markers.
  out = out.replace(/\{\{#ZCODE_ENV\}\}([\s\S]*?)\{\{\/ZCODE_ENV\}\}/g,
    (_, inner) => agent.zcodeEnv ? inner : '');

  out = out.replace(/\{\{AGENT_LABEL\}\}/g, agent.label);
  out = out.replace(/\{\{AGENT_ID\}\}/g, agent.id);

  return out;
}

// Hard fail: render invariant violated. Caught by the pre-commit hook so a
// half-rendered file can never be committed. Three checks:
//   1. no unresolved {{...}} placeholders remain
//   2. the rendered output is syntactically valid JS (node --check)
//   3. the rendered module actually loads and its key functions return values
//      of the expected type — catches "syntactically valid but logically
//      broken" bugs like a missing `return` that node --check won't flag.
function assertClean(agentId, rendered) {
  const leftovers = rendered.match(/\{\{[^}]+\}\}/);
  if (leftovers) {
    process.stderr.write(
      `[sync-shared] ERROR: unresolved placeholder ${leftovers[0]} ` +
      `in ${agentId} output. Template is malformed.\n`
    );
    process.exit(2);
  }
  const { spawnSync } = require('child_process');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `caveman-sync-${agentId}-${process.pid}.js`);
  try {
    fs.writeFileSync(tmp, rendered);
    // Check 2: syntax.
    const syn = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf-8' });
    if (syn.status !== 0) {
      process.stderr.write(
        `[sync-shared] ERROR: ${agentId} output failed node --check:\n` +
        `${syn.stderr || syn.stdout}\n`
      );
      process.exit(2);
    }
    // Check 3: load + behavior. Runs in a child process so a thrown error
    // doesn't kill the sync itself; we read its verdict from exit code.
    const probe = `
      const m = require(${JSON.stringify(tmp)});
      const root = m.getCavemanRoot();
      const flag = m.getAgentFlagPath();
      const ok = typeof root === 'string' && root.length > 0
              && typeof flag === 'string' && flag.length > 0
              && m.AGENT_ID === ${JSON.stringify(agentId)};
      process.exit(ok ? 0 : 1);
    `;
    const run = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf-8' });
    if (run.status !== 0) {
      process.stderr.write(
        `[sync-shared] ERROR: ${agentId} output loaded but behavior check failed:\n` +
        `${run.stderr || run.stdout}\n`
      );
      process.exit(2);
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
  }
}

function main() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    process.stderr.write(`[sync-shared] ERROR: template not found at ${TEMPLATE_PATH}\n`);
    process.exit(2);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  let changed = 0;
  let unchanged = 0;

  for (const agent of AGENTS) {
    const target = path.join(
      REPO_ROOT, 'plugins', 'caveman', 'hooks', agent.id, 'caveman-config.js'
    );
    const rendered = render(template, agent);
    assertClean(agent.id, rendered);

    let existing = '';
    try { existing = fs.readFileSync(target, 'utf-8'); } catch { /* missing */ }

    if (existing === rendered) {
      unchanged++;
      console.log(`  ✓ ${agent.id.padEnd(10)} in sync`);
    } else {
      fs.writeFileSync(target, rendered);
      changed++;
      console.log(`  → ${agent.id.padEnd(10)} updated`);
    }
  }

  console.log(`\n[sync-shared] ${changed} updated, ${unchanged} in sync.`);

  // Exit 1 if anything changed — signals the pre-commit hook to re-stage.
  // Manual runs (`npm run sync:shared`) also see this code; it's harmless.
  process.exit(changed > 0 ? 1 : 0);
}

main();
