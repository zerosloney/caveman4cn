#!/usr/bin/env node
// caveman — Qoder PostToolUse hook
// Tracks tool usage for caveman stats. Logs to local file for stats command.
//
// Qoder contract:
//   - stdin: JSON { hook_event_name, tool_name, tool_response, ... }
//   - stdout: JSON. additionalContext is the only recognized key for injection.
//     PostToolUse is NOT blockable in Qoder — emit {} when nothing to inject.
//   - Emit {additionalContext: "..."} to inject a note.

const path = require('path');
const fs = require('fs');

function logStats(toolName, toolResponse) {
  // Append to a local stats log for the caveman-stats command
  try {
    const dataDir = process.env.QODER_PLUGIN_DATA || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.caveman');
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
  const toolName = input.tool_name || '';
  const toolResponse = input.tool_response || {};

  // Log tool usage for stats
  logStats(toolName, toolResponse);

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
