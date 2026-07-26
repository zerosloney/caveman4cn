#!/usr/bin/env node
// caveman — ZCode UserPromptSubmit hook
// Checks if the user prompt is requesting caveman mode activation.
// Can block the request if the prompt is empty or missing required info.

const path = require('path');
const fs = require('fs');

function flagPath() {
  return path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.caveman-active'
  );
}

function getCavemanMode() {
  try {
    if (fs.existsSync(flagPath())) {
      return fs.readFileSync(flagPath(), 'utf-8').trim();
    }
  } catch {}
  return process.env.CAVEMAN_DEFAULT_MODE || 'full';
}

function setCavemanMode(mode) {
  try {
    fs.writeFileSync(flagPath(), mode);
  } catch {}
}

function clearCavemanMode() {
  try {
    if (fs.existsSync(flagPath())) fs.unlinkSync(flagPath());
  } catch {}
}

// Match "/caveman lite|full|ultra|wenyan*" and variants
function parseCavemanSwitch(text) {
  const m = text.match(/\bcaveman\s+(lite|full|ultra|wenyan(?:-?(?:lite|full|ultra))?)\b/i);
  return m ? m[1].toLowerCase() : null;
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) raw += chunk;

  const input = JSON.parse(raw);
  const prompt = (input.prompt || '').trim();

  // If prompt is empty or too short, block with a reason
  if (!prompt || prompt.length < 3) {
    const output = {
      continue: false,
      reason: '请在提示词中包含具体需求。',
      hookSpecificOutput: {
        hookEventName: input.hook_event_name || 'UserPromptSubmit',
        additionalContext: '空提示词被阻断。请提供具体问题描述。',
      },
    };
    process.stderr.write('[caveman] UserPromptSubmit: empty prompt blocked\n');
    process.stdout.write(JSON.stringify(output));
    process.exit(2);
  }

  // Check for caveman-related keywords and log
  const cavemanKeywords = ['caveman', 'terse', 'brief', 'concise', 'shorter', 'less token'];
  const hasCavemanRequest = cavemanKeywords.some((kw) => prompt.toLowerCase().includes(kw));
  const mode = getCavemanMode();

  // Toggle the persistent flag so /caveman actually switches mode and
  // "stop caveman" / "normal mode" reverts it. session-start.js writes the
  // flag on startup; this keeps it in sync across the session.
  const lowerPrompt = prompt.toLowerCase();
  const offPhrases = ['stop caveman', 'normal mode', 'no caveman', 'caveman off', 'disable caveman'];
  if (offPhrases.some((p) => lowerPrompt.includes(p))) {
    clearCavemanMode();
  } else {
    const switched = parseCavemanSwitch(prompt);
    if (switched) setCavemanMode(switched);
  }

  if (hasCavemanRequest) {
    process.stderr.write(`[caveman] UserPromptSubmit: caveman request detected, mode=${mode}\n`);
  }

  // Allow through
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'UserPromptSubmit',
      additionalContext: hasCavemanRequest
        ? `Caveman mode active (${mode}). Respond in compressed style.`
        : '',
    },
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`[caveman] UserPromptSubmit error: ${err.message}\n`);
  process.exit(1);
});