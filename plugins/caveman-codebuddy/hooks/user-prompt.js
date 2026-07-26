#!/usr/bin/env node
// caveman — CodeBuddy UserPromptSubmit hook
// Tracks caveman mode switches across a session and blocks empty prompts.
//
// Responsibilities:
//   - Empty/too-short prompt -> block with a reason (host shows it, no model call)
//   - "/caveman <mode>"       -> persist mode to ~/.caveman-active
//   - "stop caveman"/"normal" -> clear the flag (revert to verbose)
//   - caveman-related keyword -> inject a short reminder into additionalContext
//
// session-start.js writes the flag on startup; this keeps it in sync mid-session.

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

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Bad stdin — pass through, never trap the user.
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const prompt = (input.prompt || '').trim();

  // If prompt is empty or too short, block with a reason
  if (!prompt || prompt.length < 3) {
    const output = {
      continue: false,
      reason: 'Empty prompt blocked. Provide a specific question.',
      hookSpecificOutput: {
        hookEventName: input.hook_event_name || 'UserPromptSubmit',
        additionalContext: 'Empty prompt blocked. Provide a specific question.',
      },
    };
    process.stderr.write('[caveman] UserPromptSubmit: empty prompt blocked\n');
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // Check for caveman-related keywords and log
  const cavemanKeywords = ['caveman', 'terse', 'brief', 'concise', 'shorter', 'less token'];
  const hasCavemanRequest = cavemanKeywords.some((kw) => prompt.toLowerCase().includes(kw));
  const mode = getCavemanMode();

  // Toggle the persistent flag so /caveman actually switches mode and
  // "stop caveman" / "normal mode" reverts it.
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
  // Pass through on any error — never trap the user.
  process.stdout.write(JSON.stringify({}));
});
