#!/usr/bin/env node
// caveman — Trae Stop hook
// Checks output quality when caveman mode is active. If the model is about to
// end with verbose output in caveman mode, blocks to allow correction.
//
// Trae contract (https://docs.trae.cn/ide_hook-configuration-reference):
//   - stdin:  JSON { hook_event_name, stop_hook_active, loop_count,
//                     last_assistant_message }
//   - stdout: JSON { decision: "block", reason }  -> reason is sent back to the
//             agent as a new query, forcing it to continue.
//             exit 0 + {} -> allow the turn to end.
//   - exit 0: parse stdout. exit 2: stderr fed to model. other: ignored.
//   - loop_limit in hooks.json caps how many times Trae will re-invoke this
//     hook before giving up; we also pass loop_count through so we can force
//     through after a few tries even if Trae keeps looping.

const path = require('path');
const fs = require('fs');
const { readFlag } = require('./caveman-config');

const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const flagPath = path.join(homeDir, '.caveman-active');

const MAX_BLOCKS = 3; // matches hooks.json loop_limit; belt-and-suspenders

function isCavemanActive() {
  return readFlag(flagPath) !== null;
}

// Strip fenced and inline code so technical content isn't miscounted as filler.
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`[^`\n]*`/g, ' ');        // inline code
}

// Check if the last assistant message violates caveman rules.
function checkVerbosity(message) {
  if (!message) return null;

  const prose = stripCode(message);
  const lines = prose.split('\n');

  // Pure pleasantries only — always caveman-killable fluff. Weak hedges
  // (just/simply/actually/basically/...) are deliberately NOT counted to avoid
  // false positives in legitimate technical prose. See zcode stop.js for the
  // full rationale.
  const fillerStems = ['sure', 'certain', 'of course', 'happy to (help|assist)', 'i\'?d (suggest|recommend)', 'i (suggest|recommend)', 'my pleasure', 'glad to'];
  const fillerCount = fillerStems.reduce((sum, stem) => {
    const regex = new RegExp(`\\b${stem}\\w*\\b`, 'gi');
    const matches = prose.match(regex);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const wordCount = prose.split(/\s+/).filter(Boolean).length;
  const totalLines = lines.filter(Boolean).length;

  if (fillerCount > 3 && wordCount > 100) {
    return `[caveman] ${fillerCount} filler words across ${wordCount} words. Caveman mode requires brevity: drop filler and pleasantries, lead with the conclusion.`;
  }

  if (wordCount > 300 && totalLines > 20) {
    return `[caveman] Output too long (${wordCount} words, ${totalLines} lines). Compress to bullet points, one conclusion per line.`;
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
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const lastMessage = input.last_assistant_message || '';
  const loopCount = Number(input.loop_count) || 0;
  const stopHookActive = !!input.stop_hook_active;

  if (!isCavemanActive()) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const issue = checkVerbosity(lastMessage);
  if (issue) {
    // Trae caps re-invocation via loop_limit (3 in hooks.json). If we're
    // already past our own MAX_BLOCKS, or Trae signals we're in a re-entry
    // loop beyond the limit, force through to avoid an infinite Stop loop.
    if (loopCount >= MAX_BLOCKS) {
      process.stderr.write(`[caveman] Stop: max blocks (${MAX_BLOCKS}) reached, forcing through\n`);
      process.stdout.write(JSON.stringify({}));
      return;
    }

    // Block: Trae sends `reason` back to the agent as a new query.
    process.stderr.write(`[caveman] Stop: blocked (${loopCount + 1}/${MAX_BLOCKS}) — ${issue}\n`);
    process.stdout.write(JSON.stringify({ decision: 'block', reason: issue }));
    return;
  }

  // Output looks good — allow end.
  process.stderr.write('[caveman] Stop: output quality OK\n');
  process.stdout.write(JSON.stringify({}));
}

main().catch((err) => {
  process.stderr.write(`[caveman] Stop error: ${err.message}\n`);
  // Never trap the user on a Stop hook error — allow the turn to end.
  process.stdout.write(JSON.stringify({}));
});
