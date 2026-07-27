#!/usr/bin/env node
// caveman — Qoder PreToolUse hook
// Guards against dangerous operations. Cross-platform (Windows + Unix).
//
// Qoder contract:
//   - stdin: JSON { hook_event_name, tool_name, tool_input }
//   - stdout: JSON { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
//   - permissionDecision values: "allow" | "deny" | "ask"
//   - exit code 2 also blocks (stderr fed to model)
//
// Qoder's native tool names are PascalCase (Bash/Write/Edit/Read/...). The
// stdin tool_name also accepts snake_case aliases (run_in_terminal/create_file/
// read_file) which Qoder maps internally. normalizeToolName() below maps both
// forms to the same rule table so the guard never silently misses a tool.
//
// DESIGN: fail-closed. Any stdin parse failure or internal error -> deny.

const path = require('path');
const fs = require('fs');
const {
  readFlag, getAgentFlagPath
} = require('./caveman-config');

const flagPath = getAgentFlagPath();

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

// snake_case alias → PascalCase normalization map.
// Qoder's native tool names are PascalCase (the DANGEROUS_PATTERNS keys), but
// the stdin tool_name field also carries snake_case aliases which Qoder maps
// internally. Map both forms so the guard works regardless of which name form
// arrives. (If Qoder ever sends an unmapped name, the tool simply isn't
// checked — same as any read-only tool.)
const TOOL_NAME_ALIASES = {
  // command execution: Qoder native Bash ↔ snake_case run_in_terminal
  'run_in_terminal': 'Bash',
  'run_shell_command': 'Bash',
  'execute': 'Bash',
  'terminal': 'Bash',
  // file write: Qoder native Write ↔ snake_case create_file
  'create_file': 'Write',
  'write_file': 'Write',
  'multiedit': 'Write',
  // file edit: Qoder native Edit (no common snake_case alias, but be safe)
  'edit_file': 'Edit',
};

// Normalize any tool-name form to a DANGEROUS_PATTERNS key (PascalCase), or
// null if the tool isn't in the dangerous-check scope (e.g. read-only tools).
function normalizeToolName(toolName) {
  if (!toolName) return null;
  const str = String(toolName);
  // Direct PascalCase hit (Qoder native form)
  if (DANGEROUS_PATTERNS[str]) return str;
  // snake_case alias lookup
  const lower = str.toLowerCase();
  if (TOOL_NAME_ALIASES[lower]) return TOOL_NAME_ALIASES[lower];
  return null;
}

function checkDangerous(toolName, toolInput) {
  const key = normalizeToolName(toolName);
  if (!key) return null;
  const patterns = DANGEROUS_PATTERNS[key];
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

function allow(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason || '安全检查通过。',
    },
  };
}

function deny(reason) {
  return {
    continue: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
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
    const out = deny('安全检查异常：无法解析钩子输入，已拦截（fail-closed）。');
    process.stderr.write('[caveman] PreToolUse: malformed stdin, denying\n');
    process.stdout.write(JSON.stringify(out));
    return;
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  const dangerReason = checkDangerous(toolName, toolInput);
  if (dangerReason) {
    process.stderr.write(`[caveman] PreToolUse: blocked ${toolName}\n`);
    process.stdout.write(JSON.stringify(deny(dangerReason)));
    return;
  }

  // Caveman-mode-aware verbosity nudge (informational stderr only, does not block).
  if (normalizeToolName(toolName) === 'Write' && isCavemanActive()) {
    const content = (toolInput && toolInput.content) || '';
    if (content.length > 500 && !content.includes('\n') && !content.includes('```')) {
      process.stderr.write(`[caveman] PreToolUse: ${toolName} — long content, caveman mode active\n`);
    }
  }

  process.stdout.write(JSON.stringify(allow()));
}

// FAIL-CLOSED: any unexpected exception -> deny, never allow.
main().catch((err) => {
  process.stderr.write(`[caveman] PreToolUse error: ${err.message}\n`);
  try {
    process.stdout.write(
      JSON.stringify(deny(`安全钩子异常：${err.message}（已拦截 fail-closed）.`))
    );
  } catch {
    // Last resort: non-zero exit also blocks in Qoder (exit 2 -> stderr fed to model).
    process.stderr.write('[caveman] PreToolUse: catastrophic failure, blocking\n');
    process.exit(2);
  }
});
