#!/usr/bin/env node
// caveman — Reasonix PreToolUse hook
// Guards against dangerous operations. Cross-platform (Windows + Unix).
//
// Reasonix contract (Claude-style):
//   - stdin: JSON { event, cwd, toolName, toolArgs }
//   - PreToolUse is BLOCKING. To block: exit 2 with the reason on stderr
//     (Reasonix surfaces stderr to the model). To allow: exit 0 with empty
//     stdout, or any JSON.
//   - match field in settings.json is anchored regex: "Bash" matches only
//     "Bash", not "run_bash". Use ".*" for all tools. The installer registers
//     anchored alternations covering native + common alias tool names.
//
// DESIGN: fail-closed. Any stdin parse failure or internal error -> exit 2.

const fs = require('fs');
const {
  readFlag, getAgentFlagPath
} = require('./caveman-config');

const flagPath = getAgentFlagPath();

function isCavemanActive() {
  return readFlag(flagPath) !== null;
}

// Dangerous patterns. JS regex. Covers both Unix and Windows destructive forms.
const DANGEROUS_PATTERNS = {
  Bash: [
    // Unix recursive force deletes
    /rm\s+-rf?\s+\//,           // rm -rf /
    /rm\s+-rf?\s+~[/\s]/,       // rm -rf ~
    /rm\s+-rf?\s+\*/,           // rm -rf *
    // Windows recursive deletes
    /rmdir\s+\/s/i,             // rmdir /s
    /del\s+\/[sf]/i,            // del /s /f /q
    /Remove-Item[^\n]*-Recurse[^\n]*-Force/i, // PowerShell recursive force
    /rd\s+\/s/i,                // rd /s
    // Disk/partition destruction
    /mkfs\./i,
    /fdisk/i,
    /dd\s+if=\/dev\/zero/i,
    /format\s+[a-z]:/i,
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
    /irm[^\n]*\|\s*iex/i,
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
    // Windows system files / registry hives. toolArgs is JSON-stringified,
    // where backslashes are doubled (C:\\Windows). Use [\\/]+ to match.
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

// Reasonix does not document a canonical tool-name schema. Map both PascalCase
// (Claude-style) and common snake_case aliases so the guard never silently
// misses a destructive tool call.
const TOOL_NAME_ALIASES = {
  'run_in_terminal': 'Bash',
  'run_shell_command': 'Bash',
  'execute': 'Bash',
  'execute_command': 'Bash',
  'terminal': 'Bash',
  'create_file': 'Write',
  'write_file': 'Write',
  'multiedit': 'Write',
  'edit_file': 'Edit',
};

function normalizeToolName(toolName) {
  if (!toolName) return null;
  const str = String(toolName);
  if (DANGEROUS_PATTERNS[str]) return str;
  const lower = str.toLowerCase();
  if (TOOL_NAME_ALIASES[lower]) return TOOL_NAME_ALIASES[lower];
  return null;
}

function checkDangerous(toolName, toolArgs) {
  const key = normalizeToolName(toolName);
  if (!key) return null;
  const patterns = DANGEROUS_PATTERNS[key];
  if (!patterns) return null;

  const inputStr = JSON.stringify(toolArgs || '');
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

  // FAIL-CLOSED: malformed stdin -> block via exit 2.
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('[caveman] PreToolUse: malformed stdin, blocking (fail-closed)\n');
    process.exit(2);
  }

  const toolName = input.toolName || '';
  const toolArgs = input.toolArgs || {};

  const dangerReason = checkDangerous(toolName, toolArgs);
  if (dangerReason) {
    process.stderr.write(`[caveman] PreToolUse: blocked ${toolName} — ${dangerReason}\n`);
    process.exit(2);
  }

  // Caveman-mode-aware verbosity nudge (informational stderr only, does not block).
  if (normalizeToolName(toolName) === 'Write' && isCavemanActive()) {
    const content = (toolArgs && toolArgs.content) || '';
    if (content.length > 500 && !content.includes('\n') && !content.includes('```')) {
      process.stderr.write(`[caveman] PreToolUse: ${toolName} — long content, caveman mode active\n`);
    }
  }

  // Allow: exit 0, empty stdout.
  process.stdout.write(JSON.stringify({}));
}

// FAIL-CLOSED: any unexpected exception -> exit 2.
main().catch((err) => {
  process.stderr.write(`[caveman] PreToolUse error: ${err.message} — blocking (fail-closed)\n`);
  process.exit(2);
});
