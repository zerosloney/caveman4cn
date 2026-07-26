#!/usr/bin/env node
// caveman — ZCode PostToolUseFailure hook
// Provides recovery advice when a tool fails in caveman mode.
// Suggests compressed fixes — no verbose debugging.

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  const input = JSON.parse(raw);
  const toolName = input.tool_name || '';
  const error = input.error || '未知错误';
  const isInterrupt = input.is_interrupt || false;

  // Build targeted recovery advice based on tool type
  let recoveryAdvice = '';
  if (isInterrupt) {
    recoveryAdvice = `${toolName} 被中断。重试或简化参数。`;
  } else if (error.includes('ENOENT') || error.includes('not found')) {
    recoveryAdvice = `${toolName}: 文件/路径不存在。检查路径再试。`;
  } else if (error.includes('EACCES') || error.includes('permission')) {
    recoveryAdvice = `${toolName}: 权限不足。检查文件权限。`;
  } else if (error.includes('timeout') || error.includes('timed out')) {
    recoveryAdvice = `${toolName}: 超时。简化操作或缩小范围。`;
  } else if (error.includes('syntax') || error.includes('parse')) {
    recoveryAdvice = `${toolName}: 语法错误。检查输入格式。`;
  } else {
    recoveryAdvice = `${toolName}: ${error.slice(0, 200)}。重试或换方案。`;
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'PostToolUseFailure',
      additionalContext: `[caveman] 故障诊断: ${recoveryAdvice}`,
    },
  };

  process.stderr.write(`[caveman] PostToolUseFailure: ${toolName} — ${error.slice(0, 100)}\n`);
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] PostToolUseFailure error: ${err.message}\n`);
  process.exit(1);
});