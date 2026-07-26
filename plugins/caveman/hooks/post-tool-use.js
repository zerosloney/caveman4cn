#!/usr/bin/env node
// caveman — ZCode PostToolUse hook
// Tracks tool usage for caveman stats. Logs to local file for stats command.

const path = require('path');
const fs = require('fs');

function logStats(toolName, toolResponse) {
  // Append to a local stats log for the caveman-stats command
  try {
    const dataDir = process.env.ZCODE_PLUGIN_DATA || path.join(process.env.HOME || '.', '.caveman');
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

  const input = JSON.parse(raw);
  const toolName = input.tool_name || '';
  const toolResponse = input.tool_response || {};

  // Log tool usage for stats
  logStats(toolName, toolResponse);

  // Provide context about the tool result
  let additionalContext = '';
  if (toolResponse && typeof toolResponse === 'object') {
    const resultStr = JSON.stringify(toolResponse);
    if (resultStr.length > 5000) {
      additionalContext = `[caveman] ${toolName} 返回了较大的响应 (${resultStr.length} bytes)。`;
    }
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'PostToolUse',
      additionalContext,
    },
  };

  process.stderr.write(`[caveman] PostToolUse: ${toolName} completed\n`);
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PostToolUse error: ${err.message}\n`);
  process.exit(1);
});