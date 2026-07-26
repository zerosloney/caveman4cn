#!/usr/bin/env node
// caveman — ZCode PermissionRequest hook
// Auto-approves known safe write operations in caveman mode.
// Reduces friction for the compressed communication workflow.

const path = require('path');
const fs = require('fs');

// Known safe directories for auto-approval
const SAFE_PATH_PREFIXES = [
  'src/',
  'test/',
  'tests/',
  'lib/',
  'docs/',
  'skills/',
  'commands/',
  'agents/',
  'hooks/',
  'bin/',
  'dist/',
  'scripts/',
  '.github/',
  'config/',
  'plugins/',
];

// File extensions that are always safe to write
const SAFE_EXTENSIONS = new Set([
  '.js', '.ts', '.py', '.md', '.json', '.yaml', '.yml',
  '.toml', '.css', '.html', '.svg', '.txt', '.sh', '.ps1',
  '.mjs', '.cjs', '.mts', '.cts',
]);

function isSafePath(filePath) {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (!SAFE_EXTENSIONS.has(ext)) return false;
  return SAFE_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  const input = JSON.parse(raw);
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.path || '';

  // Auto-approve safe write operations
  if (toolName === 'Write' || toolName === 'Edit') {
    if (isSafePath(filePath)) {
      const output = {
        hookSpecificOutput: {
          hookEventName: input.hook_event_name || 'PermissionRequest',
          decision: {
            behavior: 'allow',
            message: `Caveman: ${filePath} 在安全路径中，自动允许。`,
          },
        },
      };
      process.stderr.write(`[caveman] PermissionRequest: auto-allow ${filePath}\n`);
      process.stdout.write(JSON.stringify(output));
      return;
    }
  }

  // For unknown paths, let the default permission flow handle it
  const output = {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'PermissionRequest',
      decision: {
        behavior: 'ask',
        message: `Caveman 需要确认是否允许写入 ${filePath || toolName}。`,
      },
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PermissionRequest error: ${err.message}\n`);
  process.exit(1);
});