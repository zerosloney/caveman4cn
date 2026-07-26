#!/usr/bin/env node
// caveman — ZCode PreToolUse hook
// Guards against dangerous operations when caveman mode is active.
// Checks for dangerous patterns like rm -rf, /etc/passwd writes.

const path = require('path');
const fs = require('fs');

function isCavemanActive() {
  try {
    const flagPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.caveman-active');
    return fs.existsSync(flagPath);
  } catch {
    return false;
  }
}

// Known dangerous patterns that should be denied in caveman mode
const DANGEROUS_PATTERNS = {
  Bash: [
    /rm\s+-rf\s+\//,
    /rm\s+-rf\s+~[/\s]/,
    /chmod\s+777/,
    /dd\s+if=\/dev\/zero/,
    /mkfs\./,
    /fdisk/,
    /:(){ :\|:& };:/,
    /curl.*\|\s*sh/,
    /wget.*\|\s*sh/,
    /sudo\s+rm/,
    />\/dev\/sda/,
  ],
  Write: [
    /\/etc\/(passwd|shadow|sudoers)/,
    /~\/\.ssh\//,
    /\/var\/lib\//,
  ],
};

function checkDangerous(toolName, toolInput) {
  const patterns = DANGEROUS_PATTERNS[toolName];
  if (!patterns) return null;

  const inputStr = JSON.stringify(toolInput || '');
  for (const pattern of patterns) {
    if (pattern.test(inputStr)) {
      return `操作被 caveman 安全钩子阻断：检测到危险模式 "${pattern.source}"。`;
    }
  }
  return null;
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  const input = JSON.parse(raw);
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Check for dangerous operations
  const dangerReason = checkDangerous(toolName, toolInput);
  if (dangerReason) {
    const output = {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name || 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: dangerReason,
        additionalContext: dangerReason,
      },
    };
    process.stderr.write(`[caveman] PreToolUse: blocked ${toolName}\n`);
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // Caveman mode: ensure Write operations are not overly verbose
  if (toolName === 'Write' && toolInput.content && isCavemanActive()) {
    const content = toolInput.content || '';
    // Only flag excessively verbose content (>500 chars without newlines = likely prose)
    if (content.length > 500 && !content.includes('\n') && !content.includes('```')) {
      process.stderr.write(`[caveman] PreToolUse: ${toolName} — long content, caveman mode active\n`);
    }
  }

  // Allow through
  const output = {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: '安全检查通过。',
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PreToolUse error: ${err.message}\n`);
  process.exit(1);
});