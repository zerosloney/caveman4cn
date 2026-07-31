#!/usr/bin/env node
// caveman — Trae PostToolUse hook
// Injects a brief note when a tool returns an unusually large response.
//
// Trae contract (https://docs.trae.cn/ide_hook-configuration-reference):
//   - stdin:  JSON { hook_event_name, tool_use_id, tool_name, llm_tool_name,
//                     tool_input, tool_response }
//   - stdout: JSON { decision?: "block", reason?,
//                     hookSpecificOutput: { hookEventName, additionalContext } }
//             PostToolUse can only append context or block; it cannot grant
//             permission (that's PreToolUse's role).
//   - exit 0: parse stdout. exit 2: stderr fed to model. other: ignored.

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
  const toolName = input.tool_name || input.llm_tool_name || '';
  // Provide context about the tool result only when noteworthy.
  const additionalContext = inputBytes > 5000
    ? `[caveman] ${toolName} returned a large tool event (${inputBytes} bytes).`
    : '';

  process.stderr.write(`[caveman] PostToolUse: ${toolName} completed\n`);
  process.stdout.write(
    JSON.stringify(
      additionalContext
        ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }
        : {}
    )
  );
}

main().catch((err) => {
  process.stderr.write(`[caveman] PostToolUse error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
