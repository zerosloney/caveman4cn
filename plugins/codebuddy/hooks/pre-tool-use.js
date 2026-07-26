#!/usr/bin/env node
// caveman — CodeBuddy PreToolUse hook
// Guards against dangerous operations. Cross-platform (Windows + Unix).
//
// CodeBuddy contract (verified against official plugins):
//   - stdin: JSON { hook_event_name, tool_name, tool_input }
//   - stdout: JSON { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
//   - permissionDecision values: "allow" | "deny" | "ask"
//
// DESIGN: fail-closed. Any stdin parse failure or internal error -> deny.
// (The previous shell+jq version failed OPEN: jq missing or regex error -> allow,
//  silently permitting rm -rf /.)

const path = require('path');
const fs = require('fs');

function isCavemanActive() {
  try {
    const flagPath = path.join(
      process.env.USERPROFILE || process.env.HOME || '.',
      '.caveman-active'
    );
    return fs.existsSync(flagPath);
  } catch {
    return false;
  }
}

// Dangerous patterns. JS regex (no jq, no shell escaping hell).
// Covers both Unix and Windows destructive forms.
const DANGEROUS_PATTERNS = {
  Bash: [
    // Unix recursive force deletes
    /rm\s+-rf?\s+\//, // rm -rf /
    /rm\s+-rf?\s+~[/\s]/, // rm -rf ~
    /rm\s+-rf?\s+\*/, // rm -rf *
    // Windows recursive deletes (case-insensitive matched via source flag below)
    /rmdir\s+\/s/i, // rmdir /s
    /del\s+\/[sf]/i, // del /s /f /q
    /Remove-Item[^\n]*-Recurse[^\n]*-Force/i, // PowerShell recursive force
    /rd\s+\/s/i, // rd /s (rmdir alias)
    // Disk/partition destruction
    /mkfs\./i,
    /fdisk/i,
    /dd\s+if=\/dev\/zero/i,
    /format\s+[a-z]:/i, // format C:
    />\/dev\/sd[a-z]/,
    // Privilege/permission escalation hazards
    /chmod\s+777/,
    /sudo\s+rm/i,
    // Fork bomb
    /:\(\)\s*\{\s*:\|:\&\s*\}\s*;\s*:/,
    // Pipe-to-shell remote execution
    /curl[^\n]*\|\s*(sh|bash)/i,
    /wget[^\n]*\|\s*(sh|bash)/i,
    /irm[^\n]*\|\s*iex/i, // PowerShell iex
  ],
  Write: [
    // Unix system files
    /\/etc\/(passwd|shadow|sudoers|group)/,
    // Windows system files / registry hives.
    // Match against the JSON-stringified tool_input, where backslashes are
    // doubled (C:\\Windows). Use [\\/]+ to match 1-or-2 backslashes or a slash.
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+drivers[\\/]+etc[\\/]+hosts/,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+config[\\/]+(SAM|SECURITY|SYSTEM|SOFTWARE)/,
    // SSH / credentials
    /~\/\.ssh\//,
    /\/var\/lib\//,
  ],
  Edit: [
    /\/etc\/(passwd|shadow|sudoers|group)/,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+drivers[\\/]+etc[\\/]+hosts/,
    /[A-Z]:[\\/]+[Ww]indows[\\/]+[Ss]ystem32[\\/]+config[\\/]+(SAM|SECURITY|SYSTEM|SOFTWARE)/,
    /~\/\.ssh\//,
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

  // FAIL-CLOSED: malformed stdin -> deny. Better to block than to silently allow.
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
  if (toolName === 'Write' && isCavemanActive()) {
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
    // Last resort: non-zero exit also blocks in CodeBuddy (exit 2 -> stderr fed to model).
    process.stderr.write('[caveman] PreToolUse: catastrophic failure, blocking\n');
    process.exit(2);
  }
});
