#!/usr/bin/env node
// caveman — ZCode PermissionRequest hook
// Auto-approves known safe write operations in caveman mode.
// Reduces friction for the compressed communication workflow.
//
// ZCode hook stdout contract (diagnosing-hooks §2): strict JSON schema.
// PermissionRequest uses exit codes like PreToolUse: exit 0 = allow,
// exit 2 = deny, with the reason on stderr. Emit `{}` to stdout either way.

const path = require('path');

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

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Malformed stdin — fail open (let the default permission flow handle it).
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.path || '';

  // Auto-approve safe write operations
  if ((toolName === 'Write' || toolName === 'Edit') && isSafePath(filePath)) {
    process.stderr.write(`[caveman] PermissionRequest: auto-allow ${filePath}\n`);
    process.stdout.write(JSON.stringify({}));
    // exit 0 = allow
    return;
  }

  // For unknown paths, let the default permission flow handle it (ask).
  // Emit nothing and exit 0 so the host's normal confirmation prompt runs.
  process.stdout.write(JSON.stringify({}));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PermissionRequest error: ${err.message}\n`);
  // Fail open — never deny on a hook error.
  process.stdout.write(JSON.stringify({}));
});
