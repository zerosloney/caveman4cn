#!/usr/bin/env node
// caveman — ZCode PostToolUseFailure hook
// Provides recovery advice when a tool fails in caveman mode.
// Suggests compressed fixes — no verbose debugging.
//
// ZCode hook stdout contract (diagnosing-hooks §2): strict JSON schema.
// The only recognized key for context injection is `additionalContext`.
// Emit `{}` when there's nothing to inject.

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const toolName = input.tool_name || '';
  // input.error may be a string or an object {message, stack} — normalize to string.
  const rawError = input.error;
  const error = rawError == null
    ? 'unknown error'
    : (typeof rawError === 'string'
        ? rawError
        : (rawError.message || JSON.stringify(rawError)));
  const isInterrupt = input.is_interrupt || false;

  // Build targeted recovery advice based on tool type
  let recoveryAdvice = '';
  if (isInterrupt) {
    recoveryAdvice = `${toolName} interrupted. Retry or simplify args.`;
  } else if (error.includes('ENOENT') || error.includes('not found')) {
    recoveryAdvice = `${toolName}: file/path not found. Check path, retry.`;
  } else if (error.includes('EACCES') || error.includes('permission')) {
    recoveryAdvice = `${toolName}: permission denied. Check file perms.`;
  } else if (error.includes('timeout') || error.includes('timed out')) {
    recoveryAdvice = `${toolName}: timed out. Simplify or narrow scope.`;
  } else if (error.includes('syntax') || error.includes('parse')) {
    recoveryAdvice = `${toolName}: syntax error. Check input format.`;
  } else {
    recoveryAdvice = `${toolName}: ${error.slice(0, 200)}. Retry or change approach.`;
  }

  const additionalContext = `[caveman] failure triage: ${recoveryAdvice}`;

  process.stderr.write(`[caveman] PostToolUseFailure: ${toolName} — ${error.slice(0, 100)}\n`);
  process.stdout.write(JSON.stringify({ additionalContext }));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PostToolUseFailure error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
