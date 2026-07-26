#!/usr/bin/env node
// caveman — Qwen Code PreToolUse hook
// Guards against dangerous operations. Cross-platform (Windows + Unix).
//
// Qwen Code contract:
//   - stdin: JSON { hook_event_name, tool_name, tool_input }
//   - stdout: JSON { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
//   - permissionDecision values: "allow" | "deny" | "ask"
//   - exit code 2 also blocks (stderr fed to model)
//
// DESIGN: fail-closed. Any stdin parse failure or internal error -> deny.

const path = require('path');
const { readFlag } = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const flagPath = path.join(homeDir, '.caveman-active');

function isCavemanActive() {
  return readFlag(flagPath) !== null;
}

// Qwen Code 内置工具使用 snake_case 运行时 ID（见官方 hooks.md）：
//   run_shell_command / write_file / edit / read_file / read_many_files / ...
// matcher 也接受 PascalCase 别名（Bash / WriteFile / Edit）作兼容，但
// stdin 的 tool_name 字段传的是 snake_case 原始值。这里把两种命名都映射
// 到同一组规则，避免因命名差异导致安全钩子静默失效。
//
// 危险模式按"操作语义"分组（命令执行 / 文件写入 / 文件编辑），与具体
// 工具名解耦——同一类操作的多个工具名别名共用一份规则表。
const DANGEROUS_PATTERNS = {
  // 命令执行类：run_shell_command（Qwen 原生）/ Bash（CC 别名）
  run_shell_command: [
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
  // 文件写入类：write_file（Qwen 原生）/ Write、WriteFile（CC 别名）
  write_file: [
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
  // 文件编辑类：edit（Qwen 原生，碰巧与 CC 别名一致）
  edit: [
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

// PascalCase 别名 → snake_case 规范化映射。
// 让无论 Qwen 传原始 ID 还是 CC 风格别名，都能命中同一份规则表。
const TOOL_NAME_ALIASES = {
  // 命令执行
  'bash': 'run_shell_command',
  'runshellcommand': 'run_shell_command',
  'execute': 'run_shell_command',
  'terminal': 'run_shell_command',
  // 文件写入
  'write': 'write_file',
  'writefile': 'write_file',
  'multiedit': 'write_file',
  // 文件编辑（edit 无需映射，但保留以防大小写差异）
  'edit': 'edit',
};

// 把任意形式的工具名规范化为 DANGEROUS_PATTERNS 的 key。
// 返回 null 表示该工具不在危险检查范围内（只读工具如 read_file）。
function normalizeToolName(toolName) {
  if (!toolName) return null;
  const lower = String(toolName).toLowerCase();
  // 直接命中 snake_case key
  if (DANGEROUS_PATTERNS[lower]) return lower;
  // 去除下划线后再查别名表（run_shell_command → runshellcommand）
  const compact = lower.replace(/_/g, '');
  if (TOOL_NAME_ALIASES[compact]) return TOOL_NAME_ALIASES[compact];
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
  // Qwen 的 write_file 把内容放在 tool_input.content（与 CC 的 Write 一致）。
  if (normalizeToolName(toolName) === 'write_file' && isCavemanActive()) {
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
    // Last resort: non-zero exit also blocks in Qwen Code (exit 2 -> stderr fed to model).
    process.stderr.write('[caveman] PreToolUse: catastrophic failure, blocking\n');
    process.exit(2);
  }
});
