#!/usr/bin/env node
// caveman — Qoder PostToolUseFailure hook
// Provides recovery advice when a tool fails in caveman mode.
// Suggests compressed fixes — no verbose debugging.
//
// Qoder contract:
//   - stdin: JSON { hook_event_name, tool_name, error, is_interrupt, ... }
//   - stdout: JSON. additionalContext is the only recognized key for injection.
//     PostToolUseFailure is NOT blockable in Qoder — emit {} when nothing to inject.

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
  const error = redactError(input.error || 'unknown error');
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

function redactError(value) {
  const text = value && typeof value === 'object'
    ? String(value.message || JSON.stringify(value))
    : String(value);
  return text
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|passwd|secret|access[_-]?key)\s*[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|key|api[_-]?key|password|secret)=)[^&\s]+/gi, '$1[REDACTED]');
}

main().catch((err) => {
  process.stderr.write(`[caveman] PostToolUseFailure error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
