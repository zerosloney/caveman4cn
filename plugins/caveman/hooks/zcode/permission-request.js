#!/usr/bin/env node
// caveman — ZCode PermissionRequest hook
// Reduces friction for the compressed-communication workflow by auto-allowing
// writes to known-safe project paths, while hard-denying writes to sensitive
// system/credential locations. Everything else falls through to the host's
// default permission flow (the user is prompted as normal).
//
// ZCode hook stdout contract (diagnosing-hooks §2): strict JSON schema.
// PermissionRequest follows the same rules as PreToolUse:
//   - exit 0 + {}            -> no objection; host default flow runs (user is asked)
//   - exit 0 + {permissionDecision:"allow", ...}  -> explicit allow
//   - exit 2 / permissionDecision:"deny"           -> hard deny
// This hook emits:
//   - allow  for known-safe project paths ( SAFE_PATH_PREFIXES + SAFE_EXTENSIONS )
//   - deny   for sensitive system/credential paths ( DENY_PATTERNS )
//   - {}     otherwise (host default confirmation prompt runs)

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

// Sensitive paths that this hook hard-denies regardless of caveman state.
// Symmetric with pre-tool-use.js DANGEROUS_PATTERNS for Write/Edit: credential
// files, SSH/GPG/AWS/Azure/kube dirs, system config, Windows registry hives.
// Kept narrow and explicit — false denies here block legitimate work.
const DENY_PATTERNS = [
  /\/etc\/(passwd|shadow|sudoers|group)/,
  /\/etc\/ssh\//,
  /\/boot\//,
  /\/dev\//,
  /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+drivers[\\/]+etc[\\/]+hosts/,
  /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+config[\\/]+(SAM|SECURITY|SYSTEM|SOFTWARE)/,
  /~\/\.ssh\//,
  /~\/\.gnupg\//,
  /~\/\.aws\/(credentials|config)/,
  /~\/\.azure\//,
  /~\/\.kube\//,
];

function isSafePath(filePath) {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (!SAFE_EXTENSIONS.has(ext)) return false;
  return SAFE_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isSensitivePath(filePath) {
  if (!filePath) return false;
  return DENY_PATTERNS.some((re) => re.test(filePath));
}

function allow() {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      permissionDecision: 'allow',
      permissionDecisionReason: 'caveman: known-safe project path.',
    },
  };
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
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

  // Only opine on write-family tools.
  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Hard-deny sensitive system/credential paths.
  if (isSensitivePath(filePath)) {
    process.stderr.write(`[caveman] PermissionRequest: deny ${filePath} (sensitive path)\n`);
    process.stdout.write(JSON.stringify(deny(`caveman: ${filePath} 是敏感系统/凭据路径，已拒绝写入。`)));
    return;
  }

  // Auto-approve known-safe project paths.
  if (isSafePath(filePath)) {
    process.stderr.write(`[caveman] PermissionRequest: auto-allow ${filePath}\n`);
    process.stdout.write(JSON.stringify(allow()));
    return;
  }

  // Unknown paths — emit nothing; host's normal confirmation prompt runs.
  process.stdout.write(JSON.stringify({}));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PermissionRequest error: ${err.message}\n`);
  // Fail open — never deny on a hook error.
  process.stdout.write(JSON.stringify({}));
});
