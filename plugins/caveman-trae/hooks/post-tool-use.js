#!/usr/bin/env node
// caveman — Trae PostToolUse hook
// Tracks tool usage for caveman stats. Logs to a local file.
//
// Trae contract (https://docs.trae.cn/ide_hook-configuration-reference):
//   - stdin:  JSON { hook_event_name, tool_use_id, tool_name, llm_tool_name,
//                     tool_input, tool_response }
//   - stdout: JSON { decision?: "block", reason?,
//                     hookSpecificOutput: { hookEventName, additionalContext } }
//             PostToolUse can only append context or block; it cannot grant
//             permission (that's PreToolUse's role).
//   - exit 0: parse stdout. exit 2: stderr fed to model. other: ignored.

const path = require('path');
const fs = require('fs');

function logStats(toolName, toolResponse) {
  try {
    const dataDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.caveman');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const logFile = path.join(dataDir, 'tool-usage.log');
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      tool: toolName,
      size: JSON.stringify(toolResponse || '').length,
    });
    fs.appendFileSync(logFile, entry + '\n');
  } catch {}
}

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
  const toolName = input.tool_name || input.llm_tool_name || '';
  const toolResponse = input.tool_response || {};

  logStats(toolName, toolResponse);

  // Provide context about the tool result only when noteworthy.
  let additionalContext = '';
  if (toolResponse && typeof toolResponse === 'object') {
    const resultStr = JSON.stringify(toolResponse);
    if (resultStr.length > 5000) {
      additionalContext = `[caveman] ${toolName} returned a large response (${resultStr.length} bytes).`;
    }
  }

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
