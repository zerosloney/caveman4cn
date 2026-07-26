#!/usr/bin/env node
// caveman — ZCode PreToolUse hook
// Guards against dangerous operations when caveman mode is active.
// Checks for dangerous patterns like rm -rf, /etc/passwd writes.
//
// ZCode hook stdout contract (diagnosing-hooks §2): strict JSON schema.
// PreToolUse may return a permission decision. The compliant way to express
// it under the flat schema is via exit code: exit 0 = allow (or emit `{}`);
// exit 2 = deny (block), with the reason on stderr. Emitting nothing + exit 0
// also passes through. We emit `{}` for clarity.

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
      return `Blocked by caveman safety hook: dangerous pattern "${pattern.source}" detected.`;
    }
  }
  return null;
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Malformed stdin — fail open (allow), never trap the user.
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Check for dangerous operations
  const dangerReason = checkDangerous(toolName, toolInput);
  if (dangerReason) {
    // Deny: exit 2 + reason on stderr. Host treats exit 2 as a deny for PreToolUse.
    process.stderr.write(`[caveman] PreToolUse: blocked ${toolName} — ${dangerReason}\n`);
    process.stdout.write(JSON.stringify({}));
    process.exit(2);
  }

  // Caveman mode: note overly verbose Write content (informational only)
  if (toolName === 'Write' && toolInput.content && isCavemanActive()) {
    const content = toolInput.content || '';
    if (content.length > 500 && !content.includes('\n') && !content.includes('```')) {
      process.stderr.write(`[caveman] PreToolUse: ${toolName} — long single-line content, caveman mode active\n`);
    }
  }

  // Allow through
  process.stdout.write(JSON.stringify({}));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PreToolUse error: ${err.message}\n`);
  // Fail open on any error — never block the user unexpectedly.
  process.stdout.write(JSON.stringify({}));
});
