#!/usr/bin/env node
// caveman — ZCode PreToolUse hook
// Guards against dangerous operations. Cross-platform (Windows + Unix).
//
// ZCode stdout contract: strict JSON schema.
//   - Allow: exit 0 + stdout {}
//   - Deny: exit 2 + stderr (reason), stdout {}
//   - Inject context: exit 0 + stdout { additionalContext: "..." }
//
// DESIGN: fail-closed. Any stdin parse failure or internal error -> deny.

const path = require('path');
const { readFlag } = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const flagPath = path.join(homeDir, '.caveman-active');

function isCavemanActive() {
  return readFlag(flagPath) !== null;
}

// Dangerous patterns. JS regex (no jq, no shell escaping hell).
// Covers both Unix and Windows destructive forms.
const DANGEROUS_PATTERNS = {
  Bash: [
    // Unix recursive force deletes
    /rm\s+-rf?\s+\//,           // rm -rf /
    /rm\s+-rf?\s+~[/\s]/,       // rm -rf ~
    /rm\s+-rf?\s+\*/,           // rm -rf *
    // Windows recursive deletes (case-insensitive matched via source flag below)
    /rmdir\s+\/s/i,             // rmdir /s
    /del\s+\/[sf]/i,            // del /s /f /q
    /Remove-Item[^\n]*-Recurse[^\n]*-Force/i, // PowerShell recursive force
    /rd\s+\/s/i,                // rd /s (rmdir alias)
    // Disk/partition destruction
    /mkfs\./i,
    /fdisk/i,
    /dd\s+if=\/dev\/zero/i,
    /format\s+[a-z]:/i,         // format C:
    />\/dev\/sd[a-z]/,
    // Privilege/permission escalation hazards
    /chmod\s+-R\s+777/,
    /chmod\s+777\s+\//,
    /chown\s+-R\s+[^:]+:[^:]+?\s+\//,
    /sudo\s+rm\s+-rf?\s+\//i,
    /sudo\s+dd\s+if=/i,
    /sudo\s+mkfs\./i,
    // Fork bomb
    /:\(\)\s*\{\s*:\|:\&\s*\}\s*;\s*:/,
    // Pipe-to-shell remote execution
    /curl[^\n]*\|\s*(sh|bash)/i,
    /wget[^\n]*\|\s*(sh|bash)/i,
    /irm[^\n]*\|\s*iex/i,      // PowerShell iex
    /Invoke-Expression[^\n]*\)/i,
    // Crypto miner / known malware patterns
    /xmrig/i,
    /cryptominer/i,
    /cpuminer/i,
    // Data exfiltration
    /curl[^\n]*--data(-binary)?\s+@\/etc\/passwd/i,
    /nc\s+-e\s+\/bin\/sh/i,
    /ncat\s+-e\s+\/bin\/sh/i,
    // Mass file modification
    /find\s+\/[^\n]*\s+-exec\s+chmod/i,
    /find\s+\/[^\n]*\s+-delete/i,
  ],
  Write: [
    // Unix system files
    /\/etc\/(passwd|shadow|sudoers|group)/,
    /\/etc\/ssh\//,
    /\/boot\//,
    /\/dev\//,
    // Windows system files / registry hives.
    // Match against the JSON-stringified tool_input, where backslashes are
    // doubled (C:\\Windows). Use [\\/]+ to match 1-or-2 backslashes or a slash.
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+drivers[\\/]+etc[\\/]+hosts/,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+config[\\/]+(SAM|SECURITY|SYSTEM|SOFTWARE)/,
    // SSH / credentials
    /~\/\.ssh\//,
    /\/var\/lib\//,
    /~\/\.gnupg\//,
    /~\/\.aws\/(credentials|config)/,
    /~\/\.azure\//,
    /~\/\.kube\//,
  ],
  Edit: [
    /\/etc\/(passwd|shadow|sudoers|group)/,
    /\/etc\/ssh\//,
    /\/boot\//,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+drivers[\\/]+etc[\\/]+hosts/,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+config[\\/]+(SAM|SECURITY|SYSTEM|SOFTWARE)/,
    /~\/\.ssh\//,
    /~\/\.gnupg\//,
    /~\/\.aws\/(credentials|config)/,
    /~\/\.azure\//,
    /~\/\.kube\//,
  ],
};

function checkDangerous(toolName, toolInput) {
  const patterns = DANGEROUS_PATTERNS[toolName];
  if (!patterns) return null;

  // Stringify the input so patterns can match across fields uniformly.
  const inputStr = JSON.stringify(toolInput || '');
  for (const pattern of patterns) {
    if (pattern.test(inputStr)) {
      return `操作被 caveman 安全钩子阻断：检测到危险模式 "${pattern.source}".`;
    }
  }
  return null;
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  // FAIL-CLOSED: malformed stdin -> deny.
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('[caveman] PreToolUse: malformed stdin, denying\n');
    process.stdout.write(JSON.stringify({}));
    process.exit(2);
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  const dangerReason = checkDangerous(toolName, toolInput);
  if (dangerReason) {
    process.stderr.write(`[caveman] PreToolUse: blocked ${toolName} — ${dangerReason}\n`);
    process.stdout.write(JSON.stringify({}));
    process.exit(2);
  }

  // Caveman-mode-aware verbosity nudge (informational stderr only, does not block).
  if (toolName === 'Write' && isCavemanActive()) {
    const content = (toolInput && toolInput.content) || '';
    if (content.length > 500 && !content.includes('\n') && !content.includes('```')) {
      process.stderr.write(`[caveman] PreToolUse: ${toolName} — long content, caveman mode active\n`);
    }
  }

  // Allow through
  process.stdout.write(JSON.stringify({}));
}

// FAIL-CLOSED: any unexpected exception -> deny, never allow.
main().catch((err) => {
  process.stderr.write(`[caveman] PreToolUse error: ${err.message}\n`);
  process.stderr.write('[caveman] PreToolUse: catastrophic failure, blocking\n');
  process.stdout.write(JSON.stringify({}));
  process.exit(2);
});
