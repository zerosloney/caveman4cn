#!/usr/bin/env node
// caveman — ZCode Stop hook
// Checks output quality when caveman mode is active.
// If the model is about to end with verbose output in caveman mode,
// blocks to allow correction. Max 3 consecutive blocks.

const path = require('path');
const fs = require('fs');

const COUNTER_FILE = 'caveman-stop-counter';

function getBlockCount() {
  try {
    const dataDir = process.env.ZCODE_PLUGIN_DATA || path.join(process.env.HOME || '.', '.caveman');
    const counterPath = path.join(dataDir, COUNTER_FILE);
    if (fs.existsSync(counterPath)) {
      return parseInt(fs.readFileSync(counterPath, 'utf-8').trim(), 10) || 0;
    }
  } catch {}
  return 0;
}

function incrementBlockCount() {
  try {
    const dataDir = process.env.ZCODE_PLUGIN_DATA || path.join(process.env.HOME || '.', '.caveman');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const counterPath = path.join(dataDir, COUNTER_FILE);
    const count = getBlockCount() + 1;
    fs.writeFileSync(counterPath, String(count));
    return count;
  } catch {
    return 1;
  }
}

function resetBlockCount() {
  try {
    const dataDir = process.env.ZCODE_PLUGIN_DATA || path.join(process.env.HOME || '.', '.caveman');
    const counterPath = path.join(dataDir, COUNTER_FILE);
    if (fs.existsSync(counterPath)) fs.unlinkSync(counterPath);
  } catch {}
}

function isCavemanActive() {
  try {
    const flagPath = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.caveman-active');
    return fs.existsSync(flagPath);
  } catch {
    return false;
  }
}

// Check if the last assistant message violates caveman rules
function checkVerbosity(message) {
  if (!message) return null;
  const lines = message.split('\n');

  // Count filler words as a heuristic
  const fillerWords = ['sure', 'certainly', 'of course', 'happy to', 'i\'d suggest', 'i think', 'it seems', 'just', 'basically', 'actually', 'essentially', 'simply', 'i recommend'];
  const fillerCount = fillerWords.reduce((sum, word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = message.match(regex);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const wordCount = message.split(/\s+/).length;
  const totalLines = lines.length;

  // If caveman mode is active, flag verbose output
  if (fillerCount > 3 && wordCount > 100) {
    return `[caveman] 检测到 ${fillerCount} 个填充词，共 ${wordCount} 词。Caveman 模式要求精简：去掉填充词和客套话，直接给出结论。`;
  }

  // Long final output in caveman mode
  if (wordCount > 300 && totalLines > 20) {
    return `[caveman] 输出过长 (${wordCount} 词, ${totalLines} 行)。精简为要点，每行一个结论。`;
  }

  return null;
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  const input = JSON.parse(raw);
  const lastMessage = input.last_assistant_message || '';
  const stopHookActive = input.stop_hook_active || false;

  if (!isCavemanActive()) {
    // Caveman not active — allow through
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const issue = checkVerbosity(lastMessage);
  if (issue) {
    const blockCount = incrementBlockCount();
    if (blockCount >= 3) {
      // Max blocks reached, allow through but log warning
      process.stderr.write(`[caveman] Stop: max blocks (3) reached, forcing through\n`);
      resetBlockCount();
      process.stdout.write(JSON.stringify({}));
      return;
    }

    const output = {
      decision: 'block',
      reason: issue,
      hookSpecificOutput: {
        hookEventName: input.hook_event_name || 'Stop',
        additionalContext: issue,
      },
    };
    process.stderr.write(`[caveman] Stop: blocked (${blockCount}/3) — ${issue.slice(0, 80)}\n`);
    process.stdout.write(JSON.stringify(output));
    process.exit(2);
  }

  // Output looks good — allow end
  resetBlockCount();
  process.stderr.write('[caveman] Stop: output quality OK\n');
  process.stdout.write(JSON.stringify({}));
}

main().catch((err) => {
  process.stderr.write(`[caveman] Stop error: ${err.message}\n`);
  process.exit(1);
});