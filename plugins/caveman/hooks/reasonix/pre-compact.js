#!/usr/bin/env node
// caveman — Reasonix PreCompact hook
// Injects caveman mode rules into the compression guidance so the model
// doesn't lose caveman behavior after context compression.
//
// Reasonix contract:
//   - stdin: JSON { event, cwd, trigger }
//   - PreCompact is NOT blocking. stdout (plain text) is concatenated by
//     newline to guide summary compression. We emit the preservation instruction.

const {
  readFlag, getAgentFlagPath
} = require('./caveman-config');

const flagPath = getAgentFlagPath();

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Bad stdin — pass through, never block compression.
    process.stdout.write('');
    return;
  }

  const activeMode = readFlag(flagPath);

  if (!activeMode) {
    // Caveman not active — nothing to preserve.
    process.stdout.write('');
    return;
  }

  const trigger = input.trigger || 'auto';

  process.stderr.write(`[caveman] PreCompact (${trigger}): caveman active (${activeMode})\n`);

  // Reasonix concatenates stdout lines into the compression guidance.
  process.stdout.write(
    `IMPORTANT: Caveman mode is active (${activeMode}). ` +
    `The compressed context MUST retain the instruction to: ` +
    `respond tersely, drop articles/filler/pleasantries/hedging, use fragments. ` +
    `Technical terms, code, commands, error strings must remain exact. ` +
    `Code/commits/PRs should be written normally. ` +
    `This behavior is non-negotiable and must survive compression.`
  );
}

main().catch((err) => {
  process.stderr.write(`[caveman] PreCompact error: ${err.message}\n`);
  // Never block compression on a hook error.
  process.stdout.write('');
});
