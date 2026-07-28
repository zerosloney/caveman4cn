#!/usr/bin/env node
// caveman — ZCode PostToolUse hook
// Injects a brief note when a tool returns an unusually large response.
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
  const toolResponse = input.tool_response || {};

  // Provide context about the tool result only when noteworthy
  let additionalContext = '';
  if (toolResponse && typeof toolResponse === 'object') {
    const resultStr = JSON.stringify(toolResponse);
    if (resultStr.length > 5000) {
      additionalContext = `[caveman] ${toolName} returned a large response (${resultStr.length} bytes).`;
    }
  }

  process.stderr.write(`[caveman] PostToolUse: ${toolName} completed\n`);
  process.stdout.write(
    JSON.stringify(additionalContext ? { additionalContext } : {})
  );
}

main().catch((err) => {
  process.stderr.write(`[caveman] PostToolUse error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
