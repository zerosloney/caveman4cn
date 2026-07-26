#!/usr/bin/env node
// caveman — Qwen Code PreCompact hook
// Injects caveman mode rules into the compression guidance so the model
// doesn't lose caveman behavior after context compression.
//
// Qwen Code contract:
//   - stdin: JSON { hook_event_name, trigger: "auto"|"manual", ... }
//   - stdout: JSON. Exit code 0 + additionalContext -> injected as compression guidance.
//   - The additionalContext is added to the compression instructions, telling
//     the summarizer to preserve caveman mode behavior.

const path = require('path');
const { readFlag } = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const flagPath = path.join(homeDir, '.caveman-active');

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Bad stdin — pass through, never block compression.
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const activeMode = readFlag(flagPath);

  if (!activeMode) {
    // Caveman not active — nothing to preserve.
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const trigger = input.trigger || 'auto';

  process.stderr.write(`[caveman] PreCompact (${trigger}): caveman active (${activeMode})\n`);

  // Inject caveman mode preservation instruction into compression guidance.
  // The summarizer will see this and keep the behavior alive.
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'PreCompact',
      additionalContext:
        `IMPORTANT: Caveman mode is active (${activeMode}). ` +
        `The compressed context MUST retain the instruction to: ` +
        `respond tersely, drop articles/filler/pleasantries/hedging, use fragments. ` +
        `Technical terms, code, commands, error strings must remain exact. ` +
        `Code/commits/PRs should be written normally. ` +
        `This behavior is non-negotiable and must survive compression.`,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PreCompact error: ${err.message}\n`);
  // Never block compression on a hook error.
  process.stdout.write(JSON.stringify({ continue: true }));
});
