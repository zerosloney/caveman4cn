#!/usr/bin/env node
// caveman — Qoder PostToolUse hook
// Injects a brief note when a tool returns an unusually large response.
//
// Qoder contract:
//   - stdin: JSON { hook_event_name, tool_name, tool_response, ... }
//   - stdout: JSON. additionalContext is the only recognized key for injection.
//     PostToolUse is NOT blockable in Qoder — emit {} when nothing to inject.
//   - Emit {additionalContext: "..."} to inject a note.

const MAX_INPUT_BYTES = 1024 * 1024;

async function main() {
  let raw = '';
  let inputBytes = 0;
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) {
    inputBytes += Buffer.byteLength(chunk, 'utf8');
    if (inputBytes > MAX_INPUT_BYTES) {
      process.stdout.write(JSON.stringify({}));
      return;
    }
    raw += chunk;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const toolName = input.tool_name || '';
  // Provide context about the tool result only when noteworthy
  const additionalContext = inputBytes > 5000
    ? `[caveman] ${toolName} returned a large tool event (${inputBytes} bytes).`
    : '';

  process.stderr.write(`[caveman] PostToolUse: ${toolName} completed\n`);
  process.stdout.write(
    JSON.stringify(additionalContext ? { additionalContext } : {})
  );
}

main().catch((err) => {
  process.stderr.write(`[caveman] PostToolUse error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
