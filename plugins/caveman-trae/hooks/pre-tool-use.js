#!/usr/bin/env node
// caveman — Trae PreToolUse hook
// Guards against dangerous operations. Cross-platform (Windows + Unix).
//
// Trae contract (https://docs.trae.cn/ide_hook-configuration-reference):
//   - stdin:  JSON { hook_event_name, tool_use_id, tool_name, llm_tool_name, tool_input }
//   - stdout: JSON { hookSpecificOutput: {
//       hookEventName: "PreToolUse",
//       permissionDecision: "allow" | "deny" | "ask",
//       permissionDecisionReason,
//       updatedInput?, additionalContext? } }
//   - exit 0: parse stdout. exit 2: stderr fed to model. other: ignored.
//
// Trae tool names differ from Claude Code (e.g. Terminal/RunCommand vs Bash,
// "File System" vs Write). We normalize tool_name to a canonical key before
// pattern matching so the dangerous-op catalogue applies regardless of name.
//
// DESIGN: fail-closed. Any stdin parse failure or internal error -> deny.

const path = require('path');
const fs = require('fs');
const { readFlag } = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const flagPath = path.join(homeDir, '.caveman-active');

function isCavemanActive() {
  return readFlag(flagPath) !== null;
}

// Normalize Trae / Claude / Codex tool names to canonical keys.
// Trae: Terminal, RunCommand, File System, Write, Edit.
// Claude/zcode: Bash, Write, Edit.
// Returns the DANGEROUS_PATTERNS key or null.
function canonicalToolKey(toolName) {
  const t = String(toolName || '').toLowerCase();
  if (t === 'bash' || t === 'terminal' || t === 'runcommand' || t === 'exec' || t === 'sh') {
    return 'Bash';
  }
  if (t === 'write' || t === 'file system' || t === 'filesystem' || t === 'create_file' || t === 'writefile') {
    return 'Write';
  }
  if (t === 'edit' || t === 'replace' || t === 'editfile' || t === 'modify') {
    return 'Edit';
  }
  return null;
}

// Dangerous patterns. JS regex (no jq, no shell escaping hell).
// Covers both Unix and Windows destructive forms.
const DANGEROUS_PATTERNS = {
  Bash: [
    // Unix recursive force deletes
    /rm\s+-rf?\s+\//,
    /rm\s+-rf?\s+~[/\s]/,
    /rm\s+-rf?\s+\*/,
    // Windows recursive deletes (case-insensitive)
    /rmdir\s+\/s/i,
    /del\s+\/[sf]/i,
    /Remove-Item[^\n]*-Recurse[^\n]*-Force/i,
    /rd\s+\/s/i,
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
    // Windows system files / registry hives (backslashes doubled in JSON.stringify)
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
  const key = canonicalToolKey(toolName);
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

  const toolName = input.tool_name || input.llm_tool_name || '';
  const toolInput = input.tool_input || {};

  const dangerReason = checkDangerous(toolName, toolInput);
  if (dangerReason) {
    process.stderr.write(`[caveman] PreToolUse: blocked ${toolName}\n`);
    process.stdout.write(JSON.stringify(deny(dangerReason)));
    return;
  }

  // Caveman-mode-aware verbosity nudge (informational stderr only, does not block).
  if (isCavemanActive()) {
    const key = canonicalToolKey(toolName);
    if (key === 'Write') {
      const content = (toolInput && toolInput.content) || '';
      if (content.length > 500 && !content.includes('\n') && !content.includes('```')) {
        process.stderr.write(`[caveman] PreToolUse: ${toolName} — long content, caveman mode active\n`);
      }
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
    // Last resort: exit 2 -> Trae feeds stderr to the model.
    process.stderr.write('[caveman] PreToolUse: catastrophic failure, blocking\n');
    process.exit(2);
  }
});
